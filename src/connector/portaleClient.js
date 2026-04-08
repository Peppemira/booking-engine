const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const tough = require("tough-cookie");

class PortaleClient {
  constructor() {
    const jar = new tough.CookieJar();
    this.client = wrapper(axios.create({ jar }));
    this.baseURL = "https://www.ilportaledellautomobilista.it";
  }

  async login(username, password) {
    const response = await this.client.post(
      this.baseURL + "/c/portal/login",
      new URLSearchParams({
        username,
        password
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    return response.status === 200;
  }

  async getSessioni() {
    const response = await this.client.get(
      this.baseURL +
        "/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH"
    );

    return response.data;
  }

  async prenota(payload) {
    const response = await this.client.post(
      this.baseURL +
        "/prenotazione/disponibilitaSessioneEsameEP/Read_viewErrorNewCandidato.action",
      new URLSearchParams(payload),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    return response.data;
  }

  async ricercaCandidato(dati) {
    const payload = {
      cognome: dati.cognome,
      nome: dati.nome,
      dataNascita: dati.data_nascita,
      luogoNascita: {
        comune: dati.comune_nascita,
        provincia: dati.provincia_nascita
      }
    };

    const response = await this.client.post(
      this.baseURL + "/services/gestioneRichiestaEsame/ricercaRichiestaEsame",
      payload,
      {
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

    return response.data;
  }
}

module.exports = new PortaleClient();