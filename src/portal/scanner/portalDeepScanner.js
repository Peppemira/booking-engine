async function portalDeepScanner(page) {

    if (!page) {
        throw new Error("portalDeepScanner: page non ricevuta")
    }

    console.log("Scanner avviato")

    const url = page.url()
    console.log("Pagina corrente:", url)

    const title = await page.title()
    console.log("Titolo pagina:", title)

}

module.exports = portalDeepScanner