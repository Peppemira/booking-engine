const puppeteer = require("puppeteer")

async function runPortalSync() {

    console.log("Avvio browser...")

    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ["--start-maximized"]
    })

    const page = await browser.newPage()

    console.log("Apro il portale...")

    await page.goto(
        "https://www.ilportaledellautomobilista.it",
        {
            waitUntil: "networkidle2",
            timeout: 60000
        }
    )

    console.log("Portale aperto")

    return { browser, page }

}

module.exports = runPortalSync
