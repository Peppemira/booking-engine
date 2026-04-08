require("dotenv").config()
const puppeteer = require("puppeteer")

async function start(){

    console.log("Avvio browser")

    const browser = await puppeteer.launch({
        headless:false,
        defaultViewport:null,
        args:["--start-maximized"]
    })

    const page = await browser.newPage()

    const username = process.env.PORTAL_USERNAME
    const password = process.env.PORTAL_PASSWORD
    const pin = process.env.PORTAL_PIN

     if(!username || !password || !pin){
        console.log("Credenziali mancanti nel file .env")
        return
    }

    console.log("Apro pagina login")

    await page.goto(
        "https://www.ilportaledellautomobilista.it/web/portale-automobilista/loginspid",
        { waitUntil:"networkidle2" }
    )

    await new Promise(r=>setTimeout(r,4000))

    console.log("Inserisco username")

    await page.type('input[type="text"]', username,{delay:50})

    console.log("Inserisco password")

    await page.type('input[type="password"]', password,{delay:50})

    console.log("Invio login")

await page.click('button[type="submit"],input[type="submit"]')

// aspetta il redirect automatico
await page.waitForNavigation({waitUntil:"networkidle2"})

console.log("Login completato")

console.log("Pagina attuale:", await page.url())
console.log("Attendo caricamento homepage professionista")

await new Promise(r=>setTimeout(r,5000))

console.log("Cerco link Sistema Unico Prenotazione Esami")

await page.evaluate(() => {

    const links = Array.from(document.querySelectorAll("a"))

    const target = links.find(l =>
        l.innerText.includes("Sistema Unico Prenotazione")
    )

    if(target){
        target.click()
    }

})

await new Promise(r=>setTimeout(r,6000))

console.log("Pagina PIN caricata")

console.log("Inserisco PIN")

await page.type('input[type="text"],input[type="password"]', pin,{delay:50})

await new Promise(r=>setTimeout(r,1000))

console.log("Invio PIN")

await page.click('button,input[type="submit"]')

await new Promise(r=>setTimeout(r,6000))

console.log("Accesso completato")

console.log("Pagina finale:", await page.url())
// il portale arriva sempre qui
// homepage-professionista

await new Promise(r=>setTimeout(r,5000))

console.log("Apro pagina sistema prenotazione")

await page.goto(
"https://www.ilportaledellautomobilista.it/SSO/SSOLogin/DispatcherEntry_executeDispatch.action?goto=http%3A%2F%2Fwww.ilportaledellautomobilista.it%2Fprenotazione",
{ waitUntil:"networkidle2" }
)

await new Promise(r=>setTimeout(r,4000))

console.log("Pagina PIN caricata")

console.log("Inserisco PIN")

await page.type('input[name="pin"],input[type="password"],input[type="text"]', pin,{delay:50})

console.log("Invio PIN")

await page.click('button[type="submit"],input[type="submit"]')

await new Promise(r=>setTimeout(r,6000))

console.log("Accesso sistema prenotazione completato")

console.log("Pagina finale:", await page.url())

}

start()