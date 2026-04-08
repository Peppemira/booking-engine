"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { jsPDF } from "jspdf";
import { API_BASE, authHeaders } from "../../lib/authClient";

const DOCUMENT_ORDER = [
  "FRONTE CARTA IDENTITÀ",
  "RETRO CARTA IDENTITÀ",
  "FRONTE PATENTE",
  "RETRO PATENTE",
  "ALTRO DOCUMENTO",
];

const WIZARD_STEPS = [
  "Fototessera",
  "Firma",
  "Documenti",
  "Riepilogo",
];

const SUMMARY_FIELDS = [
  { key: "nome", label: "Nome" },
  { key: "cognome", label: "Cognome" },
  { key: "codice_fiscale", label: "Codice Fiscale" },
  { key: "data_nascita", label: "Data di nascita" },
  { key: "sesso", label: "Sesso" },
  { key: "comune_nascita", label: "Comune di nascita" },
  { key: "prov_nascita", label: "Provincia nascita" },
  { key: "tipo_documento", label: "Tipo documento" },
  { key: "numero_documento", label: "Numero documento" },
  { key: "ente_rilascio_documento", label: "Ente rilascio" },
  { key: "rilasciato_il_documento", label: "Rilasciato il" },
  { key: "scade_il_documento", label: "Scade il" },
];

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Impossibile leggere il file"));
    reader.readAsDataURL(file);
  });
}

async function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Impossibile leggere il file testo"));
    reader.readAsText(file);
  });
}

function pickFirstString(source = {}, keys = []) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeKey(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function parseDateLoose(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const slash = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slash) return `${slash[3]}-${slash[2]}-${slash[1]}`;
  const dot = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dot) return `${dot[3]}-${dot[2]}-${dot[1]}`;
  return "";
}

function parseCieTextPayload(rawText = "") {
  const text = String(rawText || "").trim();
  if (!text) return {};

  const parsed = {};
  const pairs = text.split(/\r?\n|;/).map((chunk) => chunk.trim()).filter(Boolean);
  for (const pair of pairs) {
    const match = pair.match(/^([^:=]+)[:=](.+)$/);
    if (!match) continue;
    const key = normalizeKey(match[1]);
    const value = String(match[2] || "").trim();
    if (!key || !value) continue;
    parsed[key] = value;
  }

  const cfMatch = text.toUpperCase().match(/[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]/);
  if (cfMatch && !parsed.codicefiscale && !parsed.cf) {
    parsed.cf = cfMatch[0];
  }

  return parsed;
}

function mergeCandidateFromText(text = "") {
  const raw = String(text || "");
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const joinedUpper = raw.toUpperCase();
  const candidate = {};

  const cf = joinedUpper.match(/[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]/)?.[0] || "";
  if (cf) {
    candidate.codice_fiscale = cf;
  }

  const birthDate = raw.match(/\b([0-3]\d[\/.-][0-1]\d[\/.-]\d{4})\b/)?.[1] || "";
  if (birthDate) {
    candidate.data_nascita = parseDateLoose(birthDate.replace(/\./g, "/"));
  }

  const nomeLine = lines.find((line) => /(^|\b)(NOME|NAME|GIVEN NAMES?)\b/i.test(line));
  if (nomeLine) {
    candidate.nome = nomeLine.replace(/.*?(NOME|NAME|GIVEN NAMES?)\s*[:\-]?\s*/i, "").trim();
  }

  const cognomeLine = lines.find((line) => /(^|\b)(COGNOME|SURNAME|LAST NAME)\b/i.test(line));
  if (cognomeLine) {
    candidate.cognome = cognomeLine.replace(/.*?(COGNOME|SURNAME|LAST NAME)\s*[:\-]?\s*/i, "").trim();
  }

  const documentNumber = raw.match(/\b([A-Z0-9]{6,12})\b/g)?.find((token) => /\d/.test(token) && /[A-Z]/i.test(token));
  if (documentNumber) {
    candidate.numero_documento = documentNumber;
  }

  const hasData = Object.values(candidate).some((value) => String(value || "").trim());
  return hasData ? candidate : {};
}

function tryParseJson(text = "") {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

function extractNfcRecordContent(record, decoder) {
  if (!record || !record.data) return { text: "", json: null };

  let decoded = "";
  try {
    decoded = decoder.decode(record.data);
  } catch {
    decoded = "";
  }

  const mediaType = String(record?.mediaType || "").toLowerCase();
  const recordType = String(record?.recordType || "").toLowerCase();

  if (mediaType.includes("json") || recordType === "json") {
    return { text: decoded, json: tryParseJson(decoded) };
  }

  if (recordType === "url" || recordType === "text" || recordType === "mime") {
    return { text: decoded, json: tryParseJson(decoded) };
  }

  return { text: decoded, json: tryParseJson(decoded) };
}

function normalizeCieFromNfcMessage(message) {
  const decoder = new TextDecoder();
  const records = Array.isArray(message?.records) ? message.records : [];
  const allTexts = [];

  for (const record of records) {
    const { text, json } = extractNfcRecordContent(record, decoder);
    if (json && typeof json === "object") {
      const normalized = normalizeCiePayload(json);
      if (Object.values(normalized?.anagrafica || {}).some(Boolean)) {
        return normalized;
      }
    }
    if (text) allTexts.push(text);
  }

  const mergedText = allTexts.join("\n").trim();
  const textPayload = parseCieTextPayload(mergedText);
  if (Object.keys(textPayload).length) {
    return normalizeCiePayload(textPayload);
  }

  return { anagrafica: {} };
}

function normalizeCiePayload(raw = {}) {
  const payload = raw?.cie || raw?.data || raw;
  const anagrafica = payload?.anagrafica || payload?.person || {};
  const documento = payload?.documento || payload?.document || {};
  const foto = pickFirstString(payload, ["foto_data_url", "foto", "photo_data_url", "photo"]);
  const firma = pickFirstString(payload, ["firma_data_url", "firma", "signature_data_url", "signature"]);

  const cognome = pickFirstString(payload, ["cognome", "surname", "lastName", "lastname"]) || pickFirstString(anagrafica, ["cognome", "surname", "lastName", "lastname"]);
  const nome = pickFirstString(payload, ["nome", "name", "firstName", "firstname"]) || pickFirstString(anagrafica, ["nome", "name", "firstName", "firstname"]);
  const codiceFiscale = pickFirstString(payload, ["codice_fiscale", "cf", "fiscalCode", "fiscal_code"]) || pickFirstString(anagrafica, ["codice_fiscale", "cf", "fiscalCode", "fiscal_code"]);
  const dataNascita = parseDateLoose(
    pickFirstString(payload, ["data_nascita", "birth_date", "birthDate", "dateOfBirth"]) || pickFirstString(anagrafica, ["data_nascita", "birth_date", "birthDate", "dateOfBirth"])
  );
  const sesso = pickFirstString(payload, ["sesso", "sex", "gender"]) || pickFirstString(anagrafica, ["sesso", "sex", "gender"]);
  const comuneNascita = pickFirstString(payload, ["comune_nascita", "birth_place", "birthPlace"]) || pickFirstString(anagrafica, ["comune_nascita", "birth_place", "birthPlace"]);
  const provNascita = pickFirstString(payload, ["prov_nascita", "birth_province", "birthProvince"]) || pickFirstString(anagrafica, ["prov_nascita", "birth_province", "birthProvince"]);
  const numeroDocumento = pickFirstString(payload, ["numero_documento", "document_number", "documentNumber"]) || pickFirstString(documento, ["numero_documento", "document_number", "documentNumber"]);
  const enteRilascio = pickFirstString(payload, ["ente_rilascio_documento", "issuing_authority", "issuingAuthority"]) || pickFirstString(documento, ["ente_rilascio_documento", "issuing_authority", "issuingAuthority"]);
  const rilasciatoIl = parseDateLoose(
    pickFirstString(payload, ["rilasciato_il_documento", "issue_date", "issueDate"]) || pickFirstString(documento, ["rilasciato_il_documento", "issue_date", "issueDate"])
  );
  const scadeIl = parseDateLoose(
    pickFirstString(payload, ["scade_il_documento", "expiry_date", "expiryDate"]) || pickFirstString(documento, ["scade_il_documento", "expiry_date", "expiryDate"])
  );

  const fullName = pickFirstString(payload, ["fullName", "nome_completo", "name"]);
  let normalizedNome = nome;
  let normalizedCognome = cognome;
  if ((!normalizedNome || !normalizedCognome) && fullName.includes(" ")) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      normalizedCognome = normalizedCognome || parts[0];
      normalizedNome = normalizedNome || parts.slice(1).join(" ");
    }
  }

  return {
    foto,
    firma,
    fullName,
    anagrafica: {
      nome: normalizedNome,
      cognome: normalizedCognome,
      codice_fiscale: codiceFiscale,
      data_nascita: dataNascita,
      sesso,
      comune_nascita: comuneNascita,
      prov_nascita: provNascita,
      tipo_documento: numeroDocumento || enteRilascio || rilasciatoIl || scadeIl ? "CARTA IDENTITÀ" : "",
      numero_documento: numeroDocumento,
      ente_rilascio_documento: enteRilascio,
      rilasciato_il_documento: rilasciatoIl,
      scade_il_documento: scadeIl,
    },
  };
}

function clamp(value, min = 0, max = 255) {
  return Math.min(max, Math.max(min, value));
}

async function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Impossibile elaborare l'immagine"));
    image.src = dataUrl;
  });
}

async function enhanceDocumentDataUrl(dataUrl) {
  const image = await loadImage(dataUrl);
  const maxSide = 1900;
  const scale = Math.min(1, maxSide / Math.max(image.width || 1, image.height || 1));
  const width = Math.max(1, Math.round((image.width || 1) * scale));
  const height = Math.max(1, Math.round((image.height || 1) * scale));

  const baseCanvas = document.createElement("canvas");
  baseCanvas.width = width;
  baseCanvas.height = height;
  const baseCtx = baseCanvas.getContext("2d", { willReadFrequently: true });
  if (!baseCtx) throw new Error("Canvas non disponibile");

  baseCtx.drawImage(image, 0, 0, width, height);
  const source = baseCtx.getImageData(0, 0, width, height);
  const data = source.data;

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let found = false;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      if (gray < 246) {
        found = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (!found) {
    minX = 0;
    minY = 0;
    maxX = width - 1;
    maxY = height - 1;
  }

  const padding = 18;
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width - 1, maxX + padding);
  maxY = Math.min(height - 1, maxY + padding);

  const cropWidth = Math.max(1, maxX - minX + 1);
  const cropHeight = Math.max(1, maxY - minY + 1);
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = cropWidth;
  cropCanvas.height = cropHeight;
  const cropCtx = cropCanvas.getContext("2d", { willReadFrequently: true });
  if (!cropCtx) throw new Error("Canvas non disponibile");

  cropCtx.drawImage(baseCanvas, minX, minY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  const cropped = cropCtx.getImageData(0, 0, cropWidth, cropHeight);
  const cropData = cropped.data;

  let minLum = 255;
  let maxLum = 0;
  for (let i = 0; i < cropData.length; i += 4) {
    const lum = 0.299 * cropData[i] + 0.587 * cropData[i + 1] + 0.114 * cropData[i + 2];
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
  }

  const span = Math.max(1, maxLum - minLum);

  for (let i = 0; i < cropData.length; i += 4) {
    const gray = 0.299 * cropData[i] + 0.587 * cropData[i + 1] + 0.114 * cropData[i + 2];
    const stretched = ((gray - minLum) * 255) / span;
    let enhanced = clamp((stretched - 128) * 1.7 + 128);
    if (enhanced > 214) enhanced = 255;
    if (enhanced < 28) enhanced = 0;
    cropData[i] = enhanced;
    cropData[i + 1] = enhanced;
    cropData[i + 2] = enhanced;
  }

  cropCtx.putImageData(cropped, 0, 0);
  return cropCanvas.toDataURL("image/jpeg", 0.94);
}

async function prepareOcrDataUrl(dataUrl, options = {}) {
  const image = await loadImage(dataUrl);
  const scale = Math.max(1, Number(options.scale || 1.5));
  const maxSide = Number(options.maxSide || 2300);
  const sourceMax = Math.max(image.width || 1, image.height || 1);
  const upscale = Math.min(scale, maxSide / sourceMax);
  const width = Math.max(1, Math.round((image.width || 1) * upscale));
  const height = Math.max(1, Math.round((image.height || 1) * upscale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas non disponibile");

  ctx.drawImage(image, 0, 0, width, height);
  const frame = ctx.getImageData(0, 0, width, height);
  const data = frame.data;

  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += gray;
  }
  const mean = sum / Math.max(1, data.length / 4);
  const threshold = clamp(mean - 8, 78, 190);

  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const boosted = clamp((gray - 128) * 1.55 + 128);
    const finalValue = options.binary === false ? boosted : (boosted >= threshold ? 255 : 0);
    data[i] = finalValue;
    data[i + 1] = finalValue;
    data[i + 2] = finalValue;
  }

  ctx.putImageData(frame, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.96);
}

async function rotateDataUrl90(dataUrl) {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, image.height);
  canvas.height = Math.max(1, image.width);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas non disponibile");

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(image, -image.width / 2, -image.height / 2);
  return canvas.toDataURL("image/jpeg", 0.92);
}

async function cropPortraitCenter(dataUrl, ratio = 35 / 45) {
  const image = await loadImage(dataUrl);
  const srcW = Math.max(1, image.width || 1);
  const srcH = Math.max(1, image.height || 1);
  const srcRatio = srcW / srcH;

  let cropW = srcW;
  let cropH = srcH;
  if (srcRatio > ratio) {
    cropW = Math.round(srcH * ratio);
  } else {
    cropH = Math.round(srcW / ratio);
  }

  const sx = Math.max(0, Math.round((srcW - cropW) / 2));
  const sy = Math.max(0, Math.round((srcH - cropH) / 2));
  const canvas = document.createElement("canvas");
  canvas.width = cropW;
  canvas.height = cropH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas non disponibile");

  ctx.drawImage(image, sx, sy, cropW, cropH, 0, 0, cropW, cropH);
  return canvas.toDataURL("image/jpeg", 0.94);
}

async function enhancePortraitDataUrl(dataUrl) {
  const image = await loadImage(dataUrl);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(image.width || 1, image.height || 1));
  const width = Math.max(1, Math.round((image.width || 1) * scale));
  const height = Math.max(1, Math.round((image.height || 1) * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas non disponibile");

  ctx.drawImage(image, 0, 0, width, height);
  const frame = ctx.getImageData(0, 0, width, height);
  const data = frame.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const boosted = clamp((lum - 122) * 1.15 + 128, 0, 255);
    data[i] = clamp((r * 0.6) + (boosted * 0.4), 0, 255);
    data[i + 1] = clamp((g * 0.6) + (boosted * 0.4), 0, 255);
    data[i + 2] = clamp((b * 0.6) + (boosted * 0.4), 0, 255);
  }
  ctx.putImageData(frame, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.94);
}

async function cropDataUrlByRect(dataUrl, rect = null) {
  const image = await loadImage(dataUrl);
  const srcW = Math.max(1, image.width || 1);
  const srcH = Math.max(1, image.height || 1);

  const x = Math.max(0, Math.min(srcW - 1, Math.round(Number(rect?.x || 0))));
  const y = Math.max(0, Math.min(srcH - 1, Math.round(Number(rect?.y || 0))));
  const w = Math.max(1, Math.min(srcW - x, Math.round(Number(rect?.w || srcW))));
  const h = Math.max(1, Math.min(srcH - y, Math.round(Number(rect?.h || srcH))));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas non disponibile");

  ctx.drawImage(image, x, y, w, h, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.94);
}

function distanceBetweenPoints(a, b) {
  const dx = Number(a?.x || 0) - Number(b?.x || 0);
  const dy = Number(a?.y || 0) - Number(b?.y || 0);
  return Math.sqrt((dx * dx) + (dy * dy));
}

function solveLinearSystem(matrix = []) {
  const rows = matrix.map((row) => [...row]);
  const n = rows.length;

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) {
        pivot = row;
      }
    }

    if (Math.abs(rows[pivot][col]) < 1e-9) {
      return null;
    }

    if (pivot !== col) {
      const temp = rows[col];
      rows[col] = rows[pivot];
      rows[pivot] = temp;
    }

    const div = rows[col][col];
    for (let c = col; c <= n; c += 1) {
      rows[col][c] /= div;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = rows[row][col];
      for (let c = col; c <= n; c += 1) {
        rows[row][c] -= factor * rows[col][c];
      }
    }
  }

  return rows.map((row) => row[n]);
}

function computeHomography(srcPoints = [], dstPoints = []) {
  if (!Array.isArray(srcPoints) || !Array.isArray(dstPoints) || srcPoints.length !== 4 || dstPoints.length !== 4) {
    return null;
  }

  const equations = [];
  for (let i = 0; i < 4; i += 1) {
    const x = Number(srcPoints[i].x || 0);
    const y = Number(srcPoints[i].y || 0);
    const u = Number(dstPoints[i].x || 0);
    const v = Number(dstPoints[i].y || 0);

    equations.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    equations.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }

  const solved = solveLinearSystem(equations);
  if (!solved || solved.length !== 8) return null;

  return [
    solved[0], solved[1], solved[2],
    solved[3], solved[4], solved[5],
    solved[6], solved[7], 1,
  ];
}

function applyHomographyPoint(h = [], x = 0, y = 0) {
  const hx = (h[0] * x) + (h[1] * y) + h[2];
  const hy = (h[3] * x) + (h[4] * y) + h[5];
  const hz = (h[6] * x) + (h[7] * y) + h[8];
  if (!hz) {
    return { x: 0, y: 0, valid: false };
  }
  return {
    x: hx / hz,
    y: hy / hz,
    valid: true,
  };
}

async function rectifyPerspectiveByQuad(dataUrl, quadPoints = []) {
  const image = await loadImage(dataUrl);
  if (!Array.isArray(quadPoints) || quadPoints.length !== 4) {
    throw new Error("Servono 4 punti per la rettifica");
  }

  const sourceQuad = quadPoints.map((point) => ({
    x: Math.max(0, Math.min(image.width - 1, Number(point?.x || 0))),
    y: Math.max(0, Math.min(image.height - 1, Number(point?.y || 0))),
  }));

  const topW = distanceBetweenPoints(sourceQuad[0], sourceQuad[1]);
  const bottomW = distanceBetweenPoints(sourceQuad[3], sourceQuad[2]);
  const leftH = distanceBetweenPoints(sourceQuad[0], sourceQuad[3]);
  const rightH = distanceBetweenPoints(sourceQuad[1], sourceQuad[2]);

  let outW = Math.max(40, Math.round(Math.max(topW, bottomW)));
  let outH = Math.max(40, Math.round(Math.max(leftH, rightH)));

  const maxSide = 1800;
  const scale = Math.min(1, maxSide / Math.max(outW, outH));
  outW = Math.max(40, Math.round(outW * scale));
  outH = Math.max(40, Math.round(outH * scale));

  const dstRect = [
    { x: 0, y: 0 },
    { x: outW - 1, y: 0 },
    { x: outW - 1, y: outH - 1 },
    { x: 0, y: outH - 1 },
  ];

  const h = computeHomography(dstRect, sourceQuad);
  if (!h) {
    throw new Error("Impossibile calcolare trasformazione prospettica");
  }

  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = image.width;
  srcCanvas.height = image.height;
  const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });
  if (!srcCtx) throw new Error("Canvas non disponibile");
  srcCtx.drawImage(image, 0, 0, image.width, image.height);
  const srcData = srcCtx.getImageData(0, 0, image.width, image.height).data;

  const dstCanvas = document.createElement("canvas");
  dstCanvas.width = outW;
  dstCanvas.height = outH;
  const dstCtx = dstCanvas.getContext("2d", { willReadFrequently: true });
  if (!dstCtx) throw new Error("Canvas non disponibile");
  const outImage = dstCtx.createImageData(outW, outH);
  const outData = outImage.data;

  for (let y = 0; y < outH; y += 1) {
    for (let x = 0; x < outW; x += 1) {
      const mapped = applyHomographyPoint(h, x, y);
      const outIdx = (y * outW + x) * 4;
      if (!mapped.valid) {
        outData[outIdx] = 255;
        outData[outIdx + 1] = 255;
        outData[outIdx + 2] = 255;
        outData[outIdx + 3] = 255;
        continue;
      }

      const sx = Math.round(mapped.x);
      const sy = Math.round(mapped.y);
      if (sx < 0 || sx >= image.width || sy < 0 || sy >= image.height) {
        outData[outIdx] = 255;
        outData[outIdx + 1] = 255;
        outData[outIdx + 2] = 255;
        outData[outIdx + 3] = 255;
        continue;
      }

      const srcIdx = (sy * image.width + sx) * 4;
      outData[outIdx] = srcData[srcIdx];
      outData[outIdx + 1] = srcData[srcIdx + 1];
      outData[outIdx + 2] = srcData[srcIdx + 2];
      outData[outIdx + 3] = srcData[srcIdx + 3];
    }
  }

  dstCtx.putImageData(outImage, 0, 0);
  return dstCanvas.toDataURL("image/jpeg", 0.94);
}

function detectImageFormat(dataUrl = "") {
  if (String(dataUrl).startsWith("data:image/png")) return "PNG";
  return "JPEG";
}

async function buildSingleA4Pdf(documenti = []) {
  const images = (Array.isArray(documenti) ? documenti : [])
    .filter((doc) => String(doc?.mimeType || "").startsWith("image/"))
    .sort((a, b) => {
      const ai = DOCUMENT_ORDER.indexOf(String(a?.slot || "").toUpperCase());
      const bi = DOCUMENT_ORDER.indexOf(String(b?.slot || "").toUpperCase());
      const safeAi = ai >= 0 ? ai : 999;
      const safeBi = bi >= 0 ? bi : 999;
      if (safeAi !== safeBi) return safeAi - safeBi;
      return String(a?.capturedAt || "").localeCompare(String(b?.capturedAt || ""));
    });
  if (!images.length) return "";

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 10;
  const headerHeight = 8;
  const gap = 3;

  pdf.setFontSize(10);
  pdf.text(`Documenti scannerizzati - ${new Date().toLocaleString("it-IT")}`, margin, margin + 4);

  const contentTop = margin + headerHeight;
  const contentHeight = pageHeight - contentTop - margin;
  const contentWidth = pageWidth - margin * 2;
  const count = images.length;
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / cols);
  const cellWidth = (contentWidth - gap * (cols - 1)) / cols;
  const cellHeight = (contentHeight - gap * (rows - 1)) / rows;

  for (let i = 0; i < images.length; i += 1) {
    const doc = images[i];
    const img = await loadImage(doc.dataUrl);
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = margin + col * (cellWidth + gap);
    const y = contentTop + row * (cellHeight + gap);
    const ratio = Math.min(cellWidth / Math.max(1, img.width), cellHeight / Math.max(1, img.height));
    const drawW = Math.max(1, img.width * ratio);
    const drawH = Math.max(1, img.height * ratio);
    const dx = x + (cellWidth - drawW) / 2;
    const dy = y + (cellHeight - drawH) / 2;

    pdf.setDrawColor(180);
    pdf.rect(x, y, cellWidth, cellHeight);
    pdf.addImage(doc.dataUrl, detectImageFormat(doc.dataUrl), dx, dy, drawW, drawH, undefined, "FAST");
    pdf.setFontSize(7);
    pdf.text(String(doc.slot || doc.name || `Documento ${i + 1}`).slice(0, 40), x + 1.5, y + cellHeight - 1.5);
  }

  return pdf.output("datauristring");
}

function estimatePayloadSize(payload = {}) {
  try {
    return new Blob([JSON.stringify(payload)]).size;
  } catch {
    return 0;
  }
}

function SignaturePad({ value, onChange }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const hasDrawnRef = useRef(false);

  function setupCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;

    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.2;
    return ctx;
  }

  useEffect(() => {
    const ctx = setupCanvas();
    if (!ctx) return;

    if (value && String(value).startsWith("data:image/")) {
      const image = new window.Image();
      image.onload = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(1, Math.floor(rect.width));
        const h = Math.max(1, Math.floor(rect.height));
        const ratio = Math.min(w / Math.max(1, image.width), h / Math.max(1, image.height));
        const drawW = Math.max(1, image.width * ratio);
        const drawH = Math.max(1, image.height * ratio);
        const dx = (w - drawW) / 2;
        const dy = (h - drawH) / 2;
        ctx.drawImage(image, dx, dy, drawW, drawH);
      };
      image.src = value;
      hasDrawnRef.current = true;
      return;
    }

    hasDrawnRef.current = false;
  }, [value]);

  function pointFromEvent(event) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function onPointerDown(event) {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const point = pointFromEvent(event);
    if (!point) return;
    drawingRef.current = true;
    hasDrawnRef.current = true;
    canvas.setPointerCapture?.(event.pointerId);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  }

  function onPointerMove(event) {
    if (!drawingRef.current) return;
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const point = pointFromEvent(event);
    if (!point) return;
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }

  function commitDrawing() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (hasDrawnRef.current) {
      const dataUrl = canvas.toDataURL("image/png");
      onChange(dataUrl);
    }
  }

  function clearDrawing() {
    setupCanvas();
    drawingRef.current = false;
    hasDrawnRef.current = false;
    onChange("");
  }

  return (
    <div className="mt-2">
      <canvas
        ref={canvasRef}
        className="h-36 w-full touch-none rounded-lg border border-slate-300 bg-white"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={commitDrawing}
        onPointerLeave={commitDrawing}
        onPointerCancel={commitDrawing}
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500">Firma direttamente sul display del cellulare</p>
        <button
          type="button"
          onClick={clearDrawing}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
        >
          Cancella firma
        </button>
      </div>
    </div>
  );
}

function DocumentCropModal({
  open,
  dataUrl,
  onClose,
  onApply,
}) {
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const selectingRef = useRef(false);
  const draggingQuadIndexRef = useRef(-1);
  const quadDragRafRef = useRef(0);
  const quadDragPendingRef = useRef(null);
  const startPointRef = useRef({ x: 0, y: 0 });
  const [selection, setSelection] = useState(null);
  const [mode, setMode] = useState("rect");
  const [quadPoints, setQuadPoints] = useState([]);
  const [activeQuadIndex, setActiveQuadIndex] = useState(-1);

  const flushQuadDrag = useCallback(() => {
    quadDragRafRef.current = 0;
    const pending = quadDragPendingRef.current;
    if (!pending) return;
    quadDragPendingRef.current = null;
    const { index, point } = pending;
    setQuadPoints((prev) => prev.map((p, idx) => (idx === index ? { x: point.x, y: point.y } : p)));
  }, []);

  const drawCanvas = useCallback((activeRect = null) => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const rect = activeRect || selection;
    if (rect && rect.w > 2 && rect.h > 2) {
      ctx.fillStyle = "rgba(15,23,42,0.25)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    }

    if (mode === "quad" && quadPoints.length) {
      ctx.strokeStyle = "#8b5cf6";
      ctx.lineWidth = 2;
      ctx.fillStyle = "#8b5cf6";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (let i = 0; i < quadPoints.length; i += 1) {
        const point = quadPoints[i];
        const isActive = i === activeQuadIndex;
        ctx.beginPath();
        ctx.arc(point.x, point.y, isActive ? 10 : 8, 0, Math.PI * 2);
        ctx.fillStyle = isActive ? "#7c3aed" : "#8b5cf6";
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.fillText(String(i + 1), point.x, point.y + 0.5);
        ctx.fillStyle = "#8b5cf6";
        if (i > 0) {
          const prev = quadPoints[i - 1];
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(point.x, point.y);
          ctx.stroke();
        }
      }

      if (quadPoints.length === 4) {
        ctx.beginPath();
        ctx.moveTo(quadPoints[3].x, quadPoints[3].y);
        ctx.lineTo(quadPoints[0].x, quadPoints[0].y);
        ctx.stroke();
      }
    }
  }, [selection, mode, quadPoints, activeQuadIndex]);

  useEffect(() => {
    if (!open || !dataUrl) return;
    let cancelled = false;

    (async () => {
      try {
        const image = await loadImage(dataUrl);
        if (cancelled) return;
        imageRef.current = image;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const maxW = 340;
        const maxH = 430;
        const ratio = Math.min(maxW / Math.max(1, image.width), maxH / Math.max(1, image.height), 1);
        canvas.width = Math.max(1, Math.round(image.width * ratio));
        canvas.height = Math.max(1, Math.round(image.height * ratio));
        setSelection(null);
        setQuadPoints([]);
        setMode("rect");

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        }
      } catch {
        imageRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, dataUrl]);

  useEffect(() => {
    if (!open) return;
    drawCanvas(selection);
  }, [open, selection, drawCanvas]);

  useEffect(() => () => {
    if (quadDragRafRef.current) {
      cancelAnimationFrame(quadDragRafRef.current);
      quadDragRafRef.current = 0;
    }
    quadDragPendingRef.current = null;
  }, []);

  if (!open) return null;

  function pointFromEvent(event) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(canvas.height, event.clientY - rect.top)),
    };
  }

  function nearestQuadIndex(point, threshold = 18) {
    if (!point || !Array.isArray(quadPoints) || !quadPoints.length) return -1;
    let found = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < quadPoints.length; i += 1) {
      const p = quadPoints[i];
      const dist = Math.sqrt(((p.x - point.x) ** 2) + ((p.y - point.y) ** 2));
      if (dist <= threshold && dist < bestDistance) {
        found = i;
        bestDistance = dist;
      }
    }
    return found;
  }

  function onPointerDown(event) {
    event.preventDefault();
    const point = pointFromEvent(event);
    if (!point) return;

    if (mode === "quad") {
      const hitThreshold = event.pointerType === "touch" ? 34 : 22;
      const nearestIndex = nearestQuadIndex(point, hitThreshold);
      if (nearestIndex >= 0) {
        draggingQuadIndexRef.current = nearestIndex;
        setActiveQuadIndex(nearestIndex);
        canvasRef.current?.setPointerCapture?.(event.pointerId);
        return;
      }

      setQuadPoints((prev) => {
        if (prev.length >= 4) {
          return prev;
        }
        const next = [...prev, { x: point.x, y: point.y }];
        setActiveQuadIndex(next.length - 1);
        return next;
      });
      return;
    }

    selectingRef.current = true;
    startPointRef.current = point;
    setSelection({ x: point.x, y: point.y, w: 1, h: 1 });
    canvasRef.current?.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    if (mode === "quad" && draggingQuadIndexRef.current >= 0) {
      const point = pointFromEvent(event);
      if (!point) return;
      quadDragPendingRef.current = { index: draggingQuadIndexRef.current, point };
      if (!quadDragRafRef.current) {
        quadDragRafRef.current = requestAnimationFrame(flushQuadDrag);
      }
      return;
    }

    if (!selectingRef.current) return;
    const point = pointFromEvent(event);
    if (!point) return;
    const start = startPointRef.current;
    const x = Math.min(start.x, point.x);
    const y = Math.min(start.y, point.y);
    const w = Math.max(1, Math.abs(point.x - start.x));
    const h = Math.max(1, Math.abs(point.y - start.y));
    const next = { x, y, w, h };
    setSelection(next);
    drawCanvas(next);
  }

  function onPointerUp(event) {
    selectingRef.current = false;
    draggingQuadIndexRef.current = -1;
    setActiveQuadIndex(-1);
    if (quadDragRafRef.current) {
      cancelAnimationFrame(quadDragRafRef.current);
      quadDragRafRef.current = 0;
    }
    if (quadDragPendingRef.current) {
      const pending = quadDragPendingRef.current;
      quadDragPendingRef.current = null;
      setQuadPoints((prev) => prev.map((p, idx) => (idx === pending.index ? { x: pending.point.x, y: pending.point.y } : p)));
    }
    canvasRef.current?.releasePointerCapture?.(event?.pointerId);
  }

  async function onApplyCrop() {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas) {
      return;
    }

    if (mode === "quad") {
      if (!quadPoints || quadPoints.length !== 4) {
        return;
      }

      const scaleX = image.width / canvas.width;
      const scaleY = image.height / canvas.height;
      const sourcePoints = quadPoints.map((point) => ({
        x: Math.round(point.x * scaleX),
        y: Math.round(point.y * scaleY),
      }));

      await onApply({ type: "quad", points: sourcePoints });
      return;
    }

    if (!selection || selection.w < 2 || selection.h < 2) {
      return;
    }

    const scaleX = image.width / canvas.width;
    const scaleY = image.height / canvas.height;
    const sourceRect = {
      x: Math.round(selection.x * scaleX),
      y: Math.round(selection.y * scaleY),
      w: Math.round(selection.w * scaleX),
      h: Math.round(selection.h * scaleY),
    };

    await onApply({ type: "rect", rect: sourceRect });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3">
      <div className="w-full max-w-sm rounded-lg border border-violet-200 bg-white shadow-xl overflow-hidden">
        <div className="border-b border-violet-700 bg-violet-800 px-3 py-2">
          <p className="text-sm font-bold text-white">Ritaglio manuale documento</p>
          <p className="text-[11px] text-white/80">Disegna un rettangolo sull’area del documento, poi conferma.</p>
        </div>
        <div className="p-3">
        <div className="mb-2 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setMode("rect");
              setActiveQuadIndex(-1);
              setQuadPoints([]);
            }}
            className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${mode === "rect" ? "bg-violet-600 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
          >
            Rettangolo
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("quad");
              setSelection(null);
              setActiveQuadIndex(-1);
              setQuadPoints([]);
            }}
            className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${mode === "quad" ? "bg-violet-700 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
          >
            4 Punti
          </button>
        </div>
        {mode === "quad" && (
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-violet-700">Tocca i 4 angoli del documento in ordine: 1 alto-sx, 2 alto-dx, 3 basso-dx, 4 basso-sx.</p>
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 rounded bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800">{quadPoints.length}/4</span>
              <button
                type="button"
                onClick={() => {
                  setQuadPoints([]);
                  setActiveQuadIndex(-1);
                }}
                className="rounded border border-violet-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-violet-700"
              >
                Reset
              </button>
            </div>
          </div>
        )}
        <div className="flex justify-center rounded-lg border border-slate-200 bg-slate-50 p-2">
          <canvas
            ref={canvasRef}
            className="max-h-107.5 w-auto touch-none rounded border border-slate-300 bg-white"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={onPointerUp}
          />
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={() => { void onApplyCrop(); }}
            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600"
          >
            Applica ritaglio
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

function DocumentPreviewModal({
  open,
  dataUrl,
  title,
  onClose,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-3xl rounded-lg border border-violet-200 bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-violet-700 bg-violet-800 px-4 py-2">
          <p className="text-sm font-bold text-white">Anteprima leggibile · {title || "Documento"}</p>
          <button type="button" onClick={onClose} className="rounded-lg bg-violet-600 px-3 py-1 text-xs font-semibold text-white hover:bg-violet-700">Chiudi</button>
        </div>
        <div className="p-3">
          <div className="flex max-h-[75vh] min-h-[45vh] items-center justify-center overflow-auto rounded-xl border border-slate-200 bg-slate-50">
            {String(dataUrl || "").startsWith("data:image/") ? (
              <div className="relative h-[72vh] w-full">
                <Image src={dataUrl} alt={title || "Documento"} fill unoptimized className="object-contain" />
              </div>
            ) : (
              <p className="text-sm text-slate-500">Anteprima non disponibile</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AcquisizioneRemotaPageInner() {
  const searchParams = useSearchParams();
  const token = String(searchParams?.get("token") || "").trim();
  const apiBaseFromQuery = String(searchParams?.get("apiBase") || "").trim();
  const hasToken = useMemo(() => Boolean(token), [token]);

  const [fotoDataUrl, setFotoDataUrl] = useState("");
  const [fotoTesseraDataUrl, setFotoTesseraDataUrl] = useState("");
  const [firmaDataUrl, setFirmaDataUrl] = useState("");
  const [documenti, setDocumenti] = useState([]);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [processingDoc, setProcessingDoc] = useState(false);
  const [autoCropEnabled, setAutoCropEnabled] = useState(true);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropTargetIndex, setCropTargetIndex] = useState(-1);
  const [currentStep, setCurrentStep] = useState(1);
  const [hasPatente, setHasPatente] = useState(false);
  const [ocrAutoTriggered, setOcrAutoTriggered] = useState(false);
  const [readingNfc, setReadingNfc] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [cieAnagrafica, setCieAnagrafica] = useState({});
  const [previewDocOpen, setPreviewDocOpen] = useState(false);
  const [previewDocDataUrl, setPreviewDocDataUrl] = useState("");
  const [previewDocTitle, setPreviewDocTitle] = useState("");
  const nfcAbortRef = useRef(null);
  const nfcTimeoutRef = useRef(null);
  const fotoTesseraCameraInputRef = useRef(null);
  const fotoTesseraFilesInputRef = useRef(null);
  const firmaCameraInputRef = useRef(null);
  const firmaFilesInputRef = useRef(null);

  function openDocumentPreview(doc, fallbackTitle = "Documento") {
    const mimeType = String(doc?.mimeType || "").toLowerCase();
    const dataUrl = String(doc?.dataUrl || "");
    if (mimeType === "application/pdf" && dataUrl.startsWith("data:application/pdf") && typeof window !== "undefined") {
      window.open(dataUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (!dataUrl.startsWith("data:image/")) {
      setStatus("Anteprima non disponibile per questo file");
      return;
    }
    setPreviewDocDataUrl(dataUrl);
    setPreviewDocTitle(String(doc?.slot || doc?.name || fallbackTitle));
    setPreviewDocOpen(true);
  }

  const apiCandidates = useMemo(() => {
    const unique = [];
    const push = (value) => {
      const next = String(value || "").trim().replace(/\/$/, "");
      if (!next) return;
      if (!unique.includes(next)) unique.push(next);
    };

    push(apiBaseFromQuery);
    push(API_BASE);

    if (typeof window !== "undefined") {
      const { protocol, hostname } = window.location;
      push(`${protocol}//${window.location.host}`);
      if (hostname) {
        push(`${protocol}//${hostname}:3000`);
      }
    }

    push("http://localhost:3000");
    return unique;
  }, [apiBaseFromQuery]);

  async function postWithApiFallback(path, options = {}, preferredBase = "") {
    const orderedBases = Array.from(new Set([
      String(preferredBase || "").trim(),
      ...apiCandidates,
    ].filter(Boolean)));
    let lastError = new Error("Nessun endpoint API disponibile");
    for (const base of orderedBases) {
      const url = `${base}${path}`;
      try {
        const res = await fetch(url, options);
        if (res.ok) return { res, base };
        const bodyText = await res.text().catch(() => "");
        let details = "";
        if (bodyText) {
          try {
            const parsed = JSON.parse(bodyText);
            details = String(parsed?.error || parsed?.message || bodyText).trim();
          } catch {
            details = String(bodyText || "").trim();
          }
        }
        lastError = new Error(`API ${res.status} su ${base}${details ? `: ${details}` : ""}`);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  async function onUploadSingle(setter, file, mode = "plain") {
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      if (mode === "fototessera") {
        if (autoCropEnabled) {
          const cropped = await cropPortraitCenter(dataUrl, 35 / 45);
          const enhanced = await enhancePortraitDataUrl(cropped);
          setter(enhanced);
          setStatus("Fototessera acquisita con ritaglio automatico");
        } else {
          setter(dataUrl);
          setStatus("Fototessera acquisita senza ritaglio automatico");
        }
        return;
      }
      setter(dataUrl);
    } catch (error) {
      setStatus(`Errore: ${error.message}`);
    }
  }

  async function onApplyPortraitTool(value, setter, tool = "enhance") {
    const current = String(value || "").trim();
    if (!current || !current.startsWith("data:image/")) {
      setStatus("Carica prima un'immagine");
      return;
    }

    try {
      if (tool === "rotate") {
        setter(await rotateDataUrl90(current));
        setStatus("Rotazione completata");
        return;
      }
      if (tool === "crop-id") {
        setter(await cropPortraitCenter(current, 35 / 45));
        setStatus("Ritaglio fototessera 35x45 applicato");
        return;
      }
      setter(await enhancePortraitDataUrl(current));
      setStatus("Miglioramento foto applicato");
    } catch (error) {
      setStatus(`Elaborazione immagine non riuscita: ${error.message}`);
    }
  }

  async function onCaptureDocument(file, slotOverride = "") {
    if (!file) return;
    setProcessingDoc(true);
    try {
      const raw = await fileToDataUrl(file);
      const enhanced = autoCropEnabled ? await enhanceDocumentDataUrl(raw) : raw;
      const slot = String(slotOverride || "ALTRO DOCUMENTO");
      setDocumenti((prev) => {
        const filtered = prev.filter((doc) => doc.slot !== slot);
        const nextIndex = filtered.length + 1;
        const safeName = slot.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || `documento-${nextIndex}`;
        return [
          ...filtered,
          {
            name: `${safeName}.jpg`,
            mimeType: "image/jpeg",
            dataUrl: enhanced,
            slot,
            capturedAt: new Date().toISOString(),
          },
        ];
      });
      openDocumentPreview({ dataUrl: enhanced, mimeType: "image/jpeg", slot }, slot);
      setStatus(autoCropEnabled ? `${slot} acquisito, ritagliato e migliorato automaticamente (OCR-ready)` : `${slot} acquisito senza ritaglio automatico`);
    } catch (error) {
      setStatus(`Errore documenti: ${error.message}`);
    } finally {
      setProcessingDoc(false);
    }
  }

  async function onReadNfcNcf() {
    if (typeof window === "undefined") return;
    if (readingNfc) return;
    if (!window.isSecureContext) {
      setStatus("NFC bloccato: apri il link in HTTPS (o localhost) su Chrome Android.");
      return;
    }
    if (!("NDEFReader" in window)) {
      setStatus("NFC Web non disponibile: usa Chrome Android in HTTPS oppure importa JSON/testo OCR per compilare i dati CIE.");
      return;
    }

    const stopScan = () => {
      if (nfcTimeoutRef.current) {
        clearTimeout(nfcTimeoutRef.current);
        nfcTimeoutRef.current = null;
      }
      if (nfcAbortRef.current) {
        try {
          nfcAbortRef.current.abort();
        } catch {
          // no-op
        }
        nfcAbortRef.current = null;
      }
      setReadingNfc(false);
    };

    setReadingNfc(true);
    try {
      const reader = new window.NDEFReader();
      const controller = new AbortController();
      nfcAbortRef.current = controller;
      await reader.scan({ signal: controller.signal });
      setStatus("Avvicina la CIE al telefono per leggere i dati anagrafici...");

      nfcTimeoutRef.current = setTimeout(() => {
        setStatus("Nessun tag NFC rilevato. Riprova avvicinando la CIE al retro del telefono.");
        stopScan();
      }, 18000);

      reader.addEventListener("reading", ({ message }) => {
        try {
          const parsedPayload = normalizeCieFromNfcMessage(message);

          if (parsedPayload?.anagrafica && Object.values(parsedPayload.anagrafica).some(Boolean)) {
            setCieAnagrafica((prev) => ({ ...prev, ...parsedPayload.anagrafica }));
          }

          const imported = [
            parsedPayload?.anagrafica?.nome || parsedPayload?.anagrafica?.cognome ? "anagrafica" : null,
          ].filter(Boolean);

          if (imported.length) {
            setStatus(`Dati CIE letti via NFC: ${imported.join(", ")}`);
          } else {
            setStatus("Tag NFC letto ma dati CIE non riconosciuti");
          }
        } finally {
          stopScan();
        }
      }, { once: true });
    } catch (error) {
      if (nfcTimeoutRef.current) {
        clearTimeout(nfcTimeoutRef.current);
        nfcTimeoutRef.current = null;
      }
      nfcAbortRef.current = null;
      setReadingNfc(false);
      setStatus(`Errore lettura NFC: ${error.message}`);
    }
  }

  function onStopNfcRead() {
    if (nfcTimeoutRef.current) {
      clearTimeout(nfcTimeoutRef.current);
      nfcTimeoutRef.current = null;
    }
    if (nfcAbortRef.current) {
      try {
        nfcAbortRef.current.abort();
      } catch {
        // no-op
      }
      nfcAbortRef.current = null;
    }
    setReadingNfc(false);
    setStatus("Lettura NFC interrotta");
  }

  useEffect(() => () => {
    if (nfcTimeoutRef.current) {
      clearTimeout(nfcTimeoutRef.current);
      nfcTimeoutRef.current = null;
    }
    if (nfcAbortRef.current) {
      try {
        nfcAbortRef.current.abort();
      } catch {
        // no-op
      }
      nfcAbortRef.current = null;
    }
  }, []);

  async function onImportCieFromReader(file) {
    if (!file) return;
    try {
      const text = await fileToText(file);
      const json = JSON.parse(text);
      const data = normalizeCiePayload(json);

      if (data.foto && data.foto.startsWith("data:image/")) setFotoDataUrl(data.foto);
      if (data.firma && data.firma.startsWith("data:image/")) setFirmaDataUrl(data.firma);
      if (data.anagrafica && Object.values(data.anagrafica).some(Boolean)) {
        setCieAnagrafica((prev) => ({ ...prev, ...data.anagrafica }));
      }

      const imported = [
        data.foto ? "foto" : null,
        data.firma ? "firma" : null,
        data?.anagrafica && Object.values(data.anagrafica).some(Boolean) ? "anagrafica" : null,
      ].filter(Boolean);

      setStatus(imported.length
        ? `Dati CIE importati da lettore: ${imported.join(", ")}`
        : "File JSON letto, ma senza foto/firma/dati anagrafici utilizzabili");
    } catch (error) {
      setStatus(`Import CIE da lettore non riuscito: ${error.message}`);
    }
  }

  function removeDocumento(index) {
    setDocumenti((prev) => prev.filter((_, idx) => idx !== index));
  }

  async function onEnhanceDocumento(index) {
    const docs = Array.isArray(documenti) ? documenti : [];
    const target = docs[index];
    if (!target) return;
    if (!String(target?.mimeType || "").startsWith("image/") || !String(target?.dataUrl || "").startsWith("data:image/")) {
      setStatus("Il documento selezionato non è un'immagine modificabile");
      return;
    }

    setProcessingDoc(true);
    try {
      const enhanced = await enhanceDocumentDataUrl(target.dataUrl);
      setDocumenti((prev) => prev.map((doc, idx) => (idx === index
        ? {
          ...doc,
          dataUrl: enhanced,
          mimeType: "image/jpeg",
          name: String(doc?.name || `documento-${index + 1}`).replace(/\.(png|webp|heic|heif)$/i, ".jpg"),
          enhancedAt: new Date().toISOString(),
        }
        : doc)));
      openDocumentPreview({ dataUrl: enhanced, mimeType: "image/jpeg", slot: target?.slot || `Documento ${index + 1}` }, target?.slot || `Documento ${index + 1}`);
      setStatus("Documento ritagliato e migliorato");
    } catch (error) {
      setStatus(`Elaborazione documento non riuscita: ${error.message}`);
    } finally {
      setProcessingDoc(false);
    }
  }

  function onOpenCropDocumento(index) {
    const docs = Array.isArray(documenti) ? documenti : [];
    const target = docs[index];
    if (!target) return;
    if (!String(target?.mimeType || "").startsWith("image/") || !String(target?.dataUrl || "").startsWith("data:image/")) {
      setStatus("Il documento selezionato non è un'immagine modificabile");
      return;
    }
    setCropTargetIndex(index);
    setCropModalOpen(true);
  }

  async function onApplyCropDocumento(payload) {
    const index = cropTargetIndex;
    const docs = Array.isArray(documenti) ? documenti : [];
    const target = docs[index];
    if (!target) {
      setCropModalOpen(false);
      setCropTargetIndex(-1);
      return;
    }

    setProcessingDoc(true);
    try {
      const cropType = String(payload?.type || "rect");
      const cropped = cropType === "quad"
        ? await rectifyPerspectiveByQuad(target.dataUrl, Array.isArray(payload?.points) ? payload.points : [])
        : await cropDataUrlByRect(target.dataUrl, payload?.rect || null);
      const enhanced = await enhanceDocumentDataUrl(cropped);
      setDocumenti((prev) => prev.map((doc, idx) => (idx === index
        ? {
          ...doc,
          dataUrl: enhanced,
          mimeType: "image/jpeg",
          name: String(doc?.name || `documento-${index + 1}`).replace(/\.(png|webp|heic|heif)$/i, ".jpg"),
          enhancedAt: new Date().toISOString(),
        }
        : doc)));
      openDocumentPreview({ dataUrl: enhanced, mimeType: "image/jpeg", slot: target?.slot || `Documento ${index + 1}` }, target?.slot || `Documento ${index + 1}`);
      setStatus("Ritaglio manuale applicato e documento sistemato");
      setCropModalOpen(false);
      setCropTargetIndex(-1);
    } catch (error) {
      setStatus(`Ritaglio manuale non riuscito: ${error.message}`);
    } finally {
      setProcessingDoc(false);
    }
  }

  async function onEnhanceAllDocumenti() {
    const docs = Array.isArray(documenti) ? documenti : [];
    const imageIndices = docs
      .map((doc, idx) => ({ doc, idx }))
      .filter(({ doc }) => String(doc?.mimeType || "").startsWith("image/") && String(doc?.dataUrl || "").startsWith("data:image/"));

    if (!imageIndices.length) {
      setStatus("Nessun documento immagine da ritagliare/migliorare");
      return;
    }

    setProcessingDoc(true);
    try {
      const replacements = new Map();
      for (let i = 0; i < imageIndices.length; i += 1) {
        const { doc, idx } = imageIndices[i];
        setStatus(`Ritaglio e miglioramento documenti ${i + 1}/${imageIndices.length}...`);
        const enhanced = await enhanceDocumentDataUrl(doc.dataUrl);
        replacements.set(idx, {
          ...doc,
          dataUrl: enhanced,
          mimeType: "image/jpeg",
          name: String(doc?.name || `documento-${idx + 1}`).replace(/\.(png|webp|heic|heif)$/i, ".jpg"),
          enhancedAt: new Date().toISOString(),
        });
      }

      setDocumenti((prev) => prev.map((doc, idx) => replacements.get(idx) || doc));
      setStatus(`Documenti sistemati: ${imageIndices.length} immagini ottimizzate`);
    } catch (error) {
      setStatus(`Elaborazione documenti non riuscita: ${error.message}`);
    } finally {
      setProcessingDoc(false);
    }
  }

  const onRunOcrAutoFill = useCallback(async () => {
    const imageDocs = (Array.isArray(documenti) ? documenti : []).filter((doc) => String(doc?.mimeType || "").startsWith("image/") && String(doc?.dataUrl || "").startsWith("data:image/"));
    if (!imageDocs.length) {
      setStatus("Nessuna immagine documento disponibile per OCR");
      return;
    }

    setOcrBusy(true);
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("ita+eng");
      const merged = {};
      const ocrTexts = [];

      await worker.setParameters({
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: "6",
      });

      for (let i = 0; i < imageDocs.length; i += 1) {
        const doc = imageDocs[i];
        setStatus(`OCR AI in corso (${i + 1}/${imageDocs.length})...`);

        const variants = [
          { dataUrl: doc.dataUrl, psm: "6" },
          { dataUrl: await prepareOcrDataUrl(doc.dataUrl, { scale: 1.55, binary: true }), psm: "6" },
          { dataUrl: await prepareOcrDataUrl(doc.dataUrl, { scale: 1.35, binary: false }), psm: "11" },
        ];

        for (let v = 0; v < variants.length; v += 1) {
          const variant = variants[v];
          await worker.setParameters({
            preserve_interword_spaces: "1",
            tessedit_pageseg_mode: String(variant.psm || "6"),
          });
          const result = await worker.recognize(variant.dataUrl);
          const text = String(result?.data?.text || "");
          if (text.trim()) {
            ocrTexts.push(text);
            const extracted = mergeCandidateFromText(text);
            Object.assign(merged, extracted);
          }
        }
      }

      await worker.terminate();

      if (!Object.keys(merged).length && ocrTexts.length) {
        const extractedFromMergedText = mergeCandidateFromText(ocrTexts.join("\n"));
        Object.assign(merged, extractedFromMergedText);
      }

      if (Object.keys(merged).length === 0) {
        setStatus("OCR completato, nessun dato candidato riconosciuto automaticamente");
        return;
      }

      const nextCie = {
        ...cieAnagrafica,
        ...merged,
        tipo_documento: cieAnagrafica?.tipo_documento || "CARTA IDENTITÀ",
      };
      setCieAnagrafica(nextCie);
      setStatus("OCR AI completato: dati candidato precompilati");
    } catch (error) {
      setStatus(`OCR non riuscito: ${error.message}`);
    } finally {
      setOcrBusy(false);
    }
  }, [documenti, cieAnagrafica]);

  async function onStartScannerWizard() {
    setStatus("Avvio scanner in corso...");
    try {
      const { res } = await postWithApiFallback("/api/devices/scanner/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({}),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Impossibile avviare scanner");
      }

      setStatus("Scanner avviato. Acquisisci il documento e caricalo nello slot corretto.");
    } catch (error) {
      setStatus(`Avvio scanner non riuscito: ${error.message}. Usa fotocamera o galleria/file.`);
    }
  }

  async function onCaptureScannerFileForSlot(file, slot) {
    if (!file) return;
    const mimeType = String(file?.type || "").toLowerCase();
    if (mimeType === "application/pdf") {
      try {
        const dataUrl = await fileToDataUrl(file);
        setDocumenti((prev) => {
          const filtered = prev.filter((row) => row.slot !== slot);
          return [
            ...filtered,
            {
              name: file.name || `${slot.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}.pdf`,
              mimeType: "application/pdf",
              dataUrl,
              slot,
              capturedAt: new Date().toISOString(),
            },
          ];
        });
        setStatus(`${slot} acquisito da scanner (PDF)`);
      } catch (error) {
        setStatus(`Caricamento scanner non riuscito: ${error.message}`);
      }
      return;
    }

    await onCaptureDocument(file, slot);
  }

  const requiredDocumentSlots = useMemo(() => (
    hasPatente
      ? ["FRONTE CARTA IDENTITÀ", "RETRO CARTA IDENTITÀ", "FRONTE PATENTE", "RETRO PATENTE"]
      : ["FRONTE CARTA IDENTITÀ", "RETRO CARTA IDENTITÀ"]
  ), [hasPatente]);

  const docsBySlot = useMemo(() => {
    const map = new Map();
    for (const doc of Array.isArray(documenti) ? documenti : []) {
      const slot = String(doc?.slot || "").trim();
      if (slot) map.set(slot, doc);
    }
    return map;
  }, [documenti]);

  const missingRequiredSlots = useMemo(
    () => requiredDocumentSlots.filter((slot) => !docsBySlot.get(slot)),
    [requiredDocumentSlots, docsBySlot]
  );

  function updateCieField(key, value) {
    setCieAnagrafica((prev) => ({ ...prev, [key]: value }));
  }

  function canMoveFromStep(step) {
    if (step === 1 && !fotoTesseraDataUrl) {
      setStatus("Carica prima la fototessera");
      return false;
    }
    if (step === 2 && !firmaDataUrl) {
      setStatus("Acquisisci prima la firma");
      return false;
    }
    if (step === 3 && missingRequiredSlots.length) {
      setStatus(`Completare: ${missingRequiredSlots.join(", ")}`);
      return false;
    }
    return true;
  }

  function onNextStep() {
    if (!canMoveFromStep(currentStep)) return;
    setCurrentStep((prev) => Math.min(4, prev + 1));
  }

  function onPrevStep() {
    setCurrentStep((prev) => Math.max(1, prev - 1));
  }

  useEffect(() => {
    if (currentStep !== 4) return;
    if (ocrAutoTriggered || ocrBusy || processingDoc) return;
    const hasImageDocs = (Array.isArray(documenti) ? documenti : []).some((doc) => String(doc?.mimeType || "").startsWith("image/") && String(doc?.dataUrl || "").startsWith("data:image/"));
    if (!hasImageDocs) return;
    setOcrAutoTriggered(true);
    void onRunOcrAutoFill();
  }, [currentStep, ocrAutoTriggered, ocrBusy, processingDoc, documenti, onRunOcrAutoFill]);

  async function buildPayloadWithOptions({ includeImages = true, includePdf = true } = {}) {
    const sourceDocs = Array.isArray(documenti) ? documenti : [];
    const imageDocs = includeImages ? [...sourceDocs] : [];
    const pdfDataUrl = includePdf ? await buildSingleA4Pdf(sourceDocs) : "";
    const docs = [...imageDocs];
    if (includePdf && pdfDataUrl) {
      docs.push({
        name: `documenti-a4-${Date.now()}.pdf`,
        mimeType: "application/pdf",
        dataUrl: pdfDataUrl,
      });
    }

    return {
      token,
      updatedAt: new Date().toISOString(),
      foto_data_url: fotoDataUrl || fotoTesseraDataUrl || "",
      firma_data_url: firmaDataUrl || "",
      documenti_acquisiti: docs,
      cie_data: {
        ...cieAnagrafica,
        fototessera_data_url: fotoTesseraDataUrl || "",
      },
    };
  }

  async function sendPayloadWithFallback() {
    const payload = await buildPayloadWithOptions({ includeImages: true, includePdf: true });
    const allDocs = Array.isArray(payload.documenti_acquisiti) ? payload.documenti_acquisiti : [];

    const headPayload = {
      ...payload,
      documenti_acquisiti: [],
    };

    const headResult = await postWithApiFallback(`/remote-capture/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(headPayload),
    });

    let usedBase = headResult.base;
    for (let index = 0; index < allDocs.length; index += 1) {
      const doc = allDocs[index];
      setStatus(`Invio documento ${index + 1}/${allDocs.length}...`);
      const appendPayload = {
        updatedAt: new Date().toISOString(),
        foto_data_url: "",
        firma_data_url: "",
        cie_data: {},
        documenti_acquisiti: [doc],
      };

      const appendResult = await postWithApiFallback(`/remote-capture/${encodeURIComponent(token)}?append=1`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(appendPayload),
      }, usedBase);

      usedBase = appendResult.base;
    }

    return {
      res: headResult.res,
      base: usedBase,
      mode: "chunked",
      payloadSize: estimatePayloadSize(payload),
      docsCount: allDocs.length,
    };
  }

  async function onInviaAlGestionale() {
    if (!hasToken) {
      setStatus("Token mancante nel link. Richiedi un nuovo QR/link dall'operatore.");
      return;
    }

    setSaving(true);
    try {
      const { res, base, mode, payloadSize, docsCount } = await sendPayloadWithFallback();
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Invio dati non riuscito");
      }
      const sizeKb = Math.round((payloadSize || 0) / 1024);
      setStatus(`Dati inviati al gestionale (modalità: ${mode}, doc: ${docsCount || 0}, ~${sizeKb}KB, API: ${base}). Torna al PC e premi Aggiorna dati remoti.`);
    } catch (error) {
      setStatus(`Errore salvataggio: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4">
      <main className="mx-auto max-w-xl rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-extrabold text-slate-900">Acquisizione Remota</h1>
        <p className="mt-1 text-sm text-slate-600">Scatta da fotocamera foto e documenti. I documenti vengono ottimizzati stile scanner e impaginati in un unico PDF A4.</p>

        <div className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <p className="text-xs font-semibold uppercase text-slate-600">Token collegamento</p>
          <p className="mt-1 break-all text-sm font-semibold text-slate-800">{token || "Non presente"}</p>
        </div>

        <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2">
          <p className="text-xs font-semibold text-slate-700">Ritaglio automatico foto/documenti</p>
          <button
            type="button"
            onClick={() => setAutoCropEnabled((prev) => !prev)}
            className={`rounded-lg px-3 py-1 text-xs font-semibold ${autoCropEnabled ? "bg-emerald-600 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
          >
            {autoCropEnabled ? "ON" : "OFF"}
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-2">
          <div className="grid grid-cols-4 gap-2">
            {WIZARD_STEPS.map((label, idx) => {
              const stepNumber = idx + 1;
              const active = currentStep === stepNumber;
              const done = currentStep > stepNumber;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    if (stepNumber < currentStep || canMoveFromStep(currentStep)) setCurrentStep(stepNumber);
                  }}
                  className={`rounded-lg px-2 py-2 text-[11px] font-semibold ${active ? "bg-indigo-700 text-white" : done ? "bg-emerald-100 text-emerald-800" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}
                >
                  {stepNumber}. {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 p-3">
          {currentStep === 1 && (
            <>
              <p className="text-sm font-bold text-slate-900">Step 1 · Acquisizione fototessera</p>
              <p className="mt-1 text-xs text-slate-600">Scatta o carica la fototessera.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => fotoTesseraCameraInputRef.current?.click()}
                  className="rounded-xl bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Apri fotocamera
                </button>
                <button
                  type="button"
                  onClick={() => fotoTesseraFilesInputRef.current?.click()}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                >
                  Carica da galleria/file
                </button>
              </div>
              <input
                ref={fotoTesseraCameraInputRef}
                className="hidden"
                type="file"
                accept="image/*"
                capture="user"
                onChange={(e) => {
                  void onUploadSingle(setFotoTesseraDataUrl, e.target.files?.[0], "fototessera");
                  e.target.value = "";
                }}
              />
              <input
                ref={fotoTesseraFilesInputRef}
                className="hidden"
                type="file"
                accept="image/*"
                onChange={(e) => {
                  void onUploadSingle(setFotoTesseraDataUrl, e.target.files?.[0], "fototessera");
                  e.target.value = "";
                }}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => onApplyPortraitTool(fotoTesseraDataUrl, setFotoTesseraDataUrl, "crop-id")} className="rounded-xl border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">Ritaglia 35x45</button>
                <button type="button" onClick={() => onApplyPortraitTool(fotoTesseraDataUrl, setFotoTesseraDataUrl, "enhance")} className="rounded-xl border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">Migliora</button>
                <button type="button" onClick={() => onApplyPortraitTool(fotoTesseraDataUrl, setFotoTesseraDataUrl, "rotate")} className="rounded-xl border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">Ruota 90°</button>
              </div>
              <div className="mt-2 flex h-32 items-center justify-center rounded border border-slate-200 bg-slate-50">
                {fotoTesseraDataUrl ? (
                  <div className="relative h-28 w-24 overflow-hidden rounded border border-slate-300 bg-white">
                    <Image src={fotoTesseraDataUrl} alt="Anteprima fototessera" fill unoptimized className="object-cover" />
                  </div>
                ) : <span className="text-xs text-slate-500">Nessuna fototessera</span>}
              </div>
            </>
          )}

          {currentStep === 2 && (
            <>
              <p className="text-sm font-bold text-slate-900">Step 2 · Acquisizione firma</p>
              <p className="mt-1 text-xs text-slate-600">Firma sul display del telefono oppure carica un&apos;immagine firma.</p>
              <SignaturePad value={firmaDataUrl} onChange={setFirmaDataUrl} />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => firmaCameraInputRef.current?.click()}
                  className="rounded-xl bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Apri fotocamera
                </button>
                <button
                  type="button"
                  onClick={() => firmaFilesInputRef.current?.click()}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                >
                  Carica da galleria/file
                </button>
              </div>
              <input
                ref={firmaCameraInputRef}
                className="hidden"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  void onUploadSingle(setFirmaDataUrl, e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <input
                ref={firmaFilesInputRef}
                className="hidden"
                type="file"
                accept="image/*"
                onChange={(e) => {
                  void onUploadSingle(setFirmaDataUrl, e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <div className="mt-2 flex h-24 items-center justify-center rounded border border-slate-200 bg-slate-50">
                {firmaDataUrl ? (
                  <div className="relative h-20 w-full overflow-hidden rounded border border-slate-300 bg-white">
                    <Image src={firmaDataUrl} alt="Anteprima firma" fill unoptimized className="object-contain" />
                  </div>
                ) : <span className="text-xs text-slate-500">Nessuna firma</span>}
              </div>
            </>
          )}

          {currentStep === 3 && (
            <>
              <p className="text-sm font-bold text-slate-900">Step 3 · Acquisizione documenti</p>
              <p className="mt-1 text-xs text-slate-600">Acquisisci fronte/retro carta d&apos;identità. Se presente, anche fronte/retro patente.</p>

              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                <button
                  type="button"
                  onClick={onStartScannerWizard}
                  className="rounded-lg bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Avvia scanner
                </button>
                <span className="text-[11px] text-slate-600">Dopo la scansione, carica il file nel relativo slot (anche PDF).</span>
              </div>

              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                <p className="text-xs font-semibold text-slate-700">Possiedi patente?</p>
                <div className="mt-1 flex gap-2">
                  <button type="button" onClick={() => setHasPatente(true)} className={`rounded-lg px-3 py-1 text-xs font-semibold ${hasPatente ? "bg-indigo-700 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>Sì</button>
                  <button type="button" onClick={() => setHasPatente(false)} className={`rounded-lg px-3 py-1 text-xs font-semibold ${!hasPatente ? "bg-indigo-700 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>No</button>
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {["FRONTE CARTA IDENTITÀ", "RETRO CARTA IDENTITÀ", ...(hasPatente ? ["FRONTE PATENTE", "RETRO PATENTE"] : [])].map((slot) => {
                  const doc = docsBySlot.get(slot);
                  const index = Array.isArray(documenti) ? documenti.findIndex((row) => row.slot === slot) : -1;
                  const editable = index >= 0 && String(doc?.mimeType || "").startsWith("image/") && String(doc?.dataUrl || "").startsWith("data:image/");
                  return (
                    <div key={slot} className="rounded-lg border border-slate-200 bg-white p-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-800">{slot}</p>
                        <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${doc ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{doc ? "Acquisito" : "Da acquisire"}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <label className="cursor-pointer rounded-lg bg-indigo-700 px-2.5 py-1 text-[11px] font-semibold text-white">
                          Fotocamera
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void onCaptureDocument(file, slot);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                          Galleria/File
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void onCaptureDocument(file, slot);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        <label className="cursor-pointer rounded-lg border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">
                          Da scanner
                          <input
                            type="file"
                            accept="image/*,application/pdf"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void onCaptureScannerFileForSlot(file, slot);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        {editable && (
                          <>
                            <button type="button" onClick={() => onEnhanceDocumento(index)} disabled={processingDoc} className="rounded bg-indigo-700 px-2 py-0.5 text-[11px] text-white disabled:opacity-60">Sistema</button>
                            <button type="button" onClick={() => onOpenCropDocumento(index)} disabled={processingDoc} className="rounded bg-violet-700 px-2 py-0.5 text-[11px] text-white disabled:opacity-60">Ritaglio</button>
                            <button type="button" onClick={() => openDocumentPreview(doc, slot)} className="rounded bg-emerald-700 px-2 py-0.5 text-[11px] text-white">Anteprima</button>
                          </>
                        )}
                        {index >= 0 && (
                          <button type="button" onClick={() => removeDocumento(index)} className="rounded bg-rose-600 px-2 py-0.5 text-[11px] text-white">Rimuovi</button>
                        )}
                      </div>
                      <div className="mt-2 flex h-28 items-center justify-center rounded border border-slate-200 bg-slate-50">
                        {doc && String(doc?.dataUrl || "").startsWith("data:image/") ? (
                          <div className="relative h-24 w-full overflow-hidden rounded border border-slate-300 bg-white">
                            <Image src={doc.dataUrl} alt={slot} fill unoptimized className="object-contain" />
                          </div>
                        ) : doc && String(doc?.mimeType || "") === "application/pdf" ? (
                          <span className="text-[11px] font-semibold text-slate-700">PDF acquisito</span>
                        ) : <span className="text-[11px] text-slate-500">Nessuna immagine</span>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {Array.isArray(documenti) && documenti.some((doc) => String(doc?.dataUrl || "").startsWith("data:image/")) && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <p className="text-xs font-semibold uppercase text-slate-700">Anteprima leggibile post-ritaglio</p>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {documenti
                      .filter((doc) => String(doc?.dataUrl || "").startsWith("data:image/"))
                      .map((doc, idx) => (
                        <button
                          key={`${doc?.slot || doc?.name || "doc"}-${idx}`}
                          type="button"
                          onClick={() => openDocumentPreview(doc, doc?.slot || `Documento ${idx + 1}`)}
                          className="rounded-lg border border-slate-300 bg-white p-1 text-left"
                        >
                          <p className="mb-1 truncate text-[11px] font-semibold text-slate-700">{doc?.slot || doc?.name || `Documento ${idx + 1}`}</p>
                          <div className="relative h-40 w-full overflow-hidden rounded border border-slate-200 bg-slate-50">
                            <Image src={doc.dataUrl} alt={doc?.slot || `Documento ${idx + 1}`} fill unoptimized className="object-contain" />
                          </div>
                        </button>
                      ))}
                  </div>
                </div>
              )}

              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={onEnhanceAllDocumenti}
                  disabled={processingDoc || !documenti.length}
                  className="rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 disabled:opacity-60"
                >
                  Ritaglia e sistema tutti
                </button>
                {processingDoc && <span className="text-xs text-indigo-700">Elaborazione...</span>}
              </div>
            </>
          )}

          {currentStep === 4 && (
            <>
              <p className="text-sm font-bold text-slate-900">Step 4 · Riepilogo e invio</p>
              <p className="mt-1 text-xs text-slate-600">Verifica foto, firma, documenti e campi OCR prima della conferma.</p>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <p className="text-[11px] font-semibold uppercase text-slate-600">Foto acquisita</p>
                  <div className="mt-1 flex h-24 items-center justify-center rounded border border-slate-200 bg-white">
                    {(fotoTesseraDataUrl || fotoDataUrl) ? (
                      <div className="relative h-20 w-16 overflow-hidden rounded border border-slate-300 bg-white">
                        <Image src={fotoTesseraDataUrl || fotoDataUrl} alt="Foto acquisita" fill unoptimized className="object-cover" />
                      </div>
                    ) : <span className="text-[11px] text-slate-500">Mancante</span>}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <p className="text-[11px] font-semibold uppercase text-slate-600">Firma acquisita</p>
                  <div className="mt-1 flex h-24 items-center justify-center rounded border border-slate-200 bg-white">
                    {firmaDataUrl ? (
                      <div className="relative h-16 w-full overflow-hidden rounded border border-slate-300 bg-white">
                        <Image src={firmaDataUrl} alt="Firma acquisita" fill unoptimized className="object-contain" />
                      </div>
                    ) : <span className="text-[11px] text-slate-500">Mancante</span>}
                  </div>
                </div>
              </div>

              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onRunOcrAutoFill}
                    disabled={ocrBusy || processingDoc}
                    className="rounded-xl bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    {ocrBusy ? "OCR AI..." : "Compila campi con OCR"}
                  </button>
                  <button
                    type="button"
                    onClick={onReadNfcNcf}
                    disabled={readingNfc}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                  >
                    {readingNfc ? "Lettura NFC..." : "Leggi CIE da NFC"}
                  </button>
                  {readingNfc && (
                    <button
                      type="button"
                      onClick={onStopNfcRead}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                    >
                      Ferma NFC
                    </button>
                  )}
                  <label className="cursor-pointer rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                    Importa JSON lettore USB
                    <input
                      type="file"
                      accept="application/json"
                      className="hidden"
                      onChange={(e) => onImportCieFromReader(e.target.files?.[0])}
                    />
                  </label>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SUMMARY_FIELDS.map(({ key, label }) => (
                  <div key={key}>
                    <label className="text-[11px] font-semibold uppercase text-slate-600">{label}</label>
                    <input
                      type="text"
                      value={String(cieAnagrafica?.[key] || "")}
                      onChange={(e) => updateCieField(key, e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800"
                    />
                  </div>
                ))}
              </div>

              <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2">
                <p className="text-[11px] font-semibold uppercase text-slate-600">Documenti acquisiti</p>
                <ul className="mt-1 space-y-1">
                  {requiredDocumentSlots.map((slot) => (
                    <li key={slot} className="text-xs text-slate-700">
                      {docsBySlot.get(slot) ? "✅" : "❌"} {slot}
                    </li>
                  ))}
                </ul>
              </div>

              <button
                type="button"
                onClick={onInviaAlGestionale}
                disabled={saving || processingDoc || ocrBusy || missingRequiredSlots.length > 0 || !fotoTesseraDataUrl || !firmaDataUrl}
                className="mt-3 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
              >
                {saving ? "Invio con PDF A4..." : "Conferma e invia"}
              </button>
            </>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onPrevStep}
            disabled={currentStep === 1}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
          >
            Indietro
          </button>
          {currentStep < 4 && (
            <button
              type="button"
              onClick={onNextStep}
              className="rounded-xl bg-indigo-700 px-4 py-2 text-xs font-semibold text-white"
            >
              Avanti
            </button>
          )}
        </div>

        <DocumentCropModal
          open={cropModalOpen}
          dataUrl={cropTargetIndex >= 0 ? String(documenti?.[cropTargetIndex]?.dataUrl || "") : ""}
          onClose={() => {
            setCropModalOpen(false);
            setCropTargetIndex(-1);
          }}
          onApply={onApplyCropDocumento}
        />

        <DocumentPreviewModal
          open={previewDocOpen}
          dataUrl={previewDocDataUrl}
          title={previewDocTitle}
          onClose={() => {
            setPreviewDocOpen(false);
            setPreviewDocDataUrl("");
            setPreviewDocTitle("");
          }}
        />

        <p className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700">{status || "Dopo l'invio puoi chiudere questa pagina."}</p>
      </main>
    </div>
  );
}

export default function AcquisizioneRemotaPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-100 p-4"><main className="mx-auto max-w-xl rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"><p className="text-sm text-slate-700">Caricamento acquisizione remota...</p></main></div>}>
      <AcquisizioneRemotaPageInner />
    </Suspense>
  );
}
