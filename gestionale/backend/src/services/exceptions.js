/**
 * Eccezioni/Servizio errori - equivalente a GeCA Execptions.
 * Classi di errore per Satispay, licenza, portale, ecc.
 */

class GecaException extends Error {
  constructor(message, code = null) {
    super(message);
    this.name = "GecaException";
    this.code = code;
  }
}

class SatispayException extends GecaException {
  constructor(message, code = null) {
    super(message, code);
    this.name = "SatispayException";
  }
}

class ActivationTokenNotFoundException extends SatispayException {
  constructor(message = "Activation token not found") {
    super(message, "ACTIVATION_TOKEN_NOT_FOUND");
    this.name = "ActivationTokenNotFoundException";
  }
}

class ActivationTokenAlreadyPairedException extends SatispayException {
  constructor(message = "Activation token already paired") {
    super(message, "ACTIVATION_TOKEN_ALREADY_PAIRED");
    this.name = "ActivationTokenAlreadyPairedException";
  }
}

class InvalidRsaKeyException extends SatispayException {
  constructor(message = "Invalid RSA key") {
    super(message, "INVALID_RSA_KEY");
    this.name = "InvalidRsaKeyException";
  }
}

class PortalException extends GecaException {
  constructor(message, code = null) {
    super(message, code);
    this.name = "PortalException";
  }
}

class LicenseException extends GecaException {
  constructor(message, code = null) {
    super(message, code);
    this.name = "LicenseException";
  }
}

module.exports = {
  GecaException,
  SatispayException,
  ActivationTokenNotFoundException,
  ActivationTokenAlreadyPairedException,
  InvalidRsaKeyException,
  PortalException,
  LicenseException,
};
