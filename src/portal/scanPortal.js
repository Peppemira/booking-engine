require("dotenv").config()

const puppeteer = require("puppeteer")
const fs = require("fs")

async function scrollPage(page){

    await page.evaluate(async ()=>{

        await new Promise(resolve=>{

            let totalHeight = 0
            const distance = 300

            const timer = setInterval(()=>{

                window.scrollBy(0,distance)

                totalHeight += distance

                if(totalHeight >= document.body.scrollHeight){

                    clearInterval(timer)
                    resolve()

                }

            },200)

        })

    })

}

async function findPrenotazioneFrame(page){

    for(const frame of page.frames()){

        if(frame.url().includes("prenotazione")){
            return frame
        }

    }

    return null
}

async function getSidebarMenu(frame){

    return await frame.evaluate(()=>{

        const anchors = Array.from(document.querySelectorAll("a"))

        const items = anchors
            .map(a => (a.innerText || "").trim())
            .filter(t =>
                t.length > 4 &&
                !t.toLowerCase().includes("home") &&
                !t.toLowerCase().includes("logout")
            )

        return [...new Set(items)]

    })

}

async function clickMenu(frame,text){

    return await frame.evaluate((text)=>{

        const anchors = Array.from(document.querySelectorAll("a"))

        const target = anchors.find(a =>
            (a.innerText || "").trim() === text
        )

        if(!target) return false

        target.scrollIntoView({block:"center"})
        target.click()

        return true

    },text)

}

async function scanPortal(page){

    const frame = await findPrenotazioneFrame(page)

    if(!frame){

        console.log("Frame prenotazione non trovato")
        return

    }

    console.log("Frame trovato:",frame.url())

    const menuItems = await getSidebarMenu(frame)

    console.log("Menu trovati:",menuItems)

    for(const item of menuItems){

        try{

            console.log("Apro sezione:",item)

            const clicked = await clickMenu(frame,item)

            if(!clicked){
                console.log("Menu non cliccato:",item)
                continue
            }

            await page.waitForTimeout(5000)

            await scrollPage(page)

            const html = await frame.content()

            const filename = item
                .replace(/\s+/g,"_")
                .replace(/[^\w]/g,"")

            fs.writeFileSync(scan_${filename}.html,html)

            console.log("Pagina salvata:",filename)

        }catch(e){

            console.log("Errore:",item,e.message)

        }

    }

}

async function start(){

    const browser = await puppeteer.launch({

        headless:false,
        defaultViewport:null,
        args:["--start-maximized"]

    })

    const page = await browser.newPage()

    page.on("request",req=>{

        if(req.url().includes(".action")){

            console.log("API:",req.method(),req.url())

            fs.appendFileSync(
                "portalApis.txt",
                req.method()+" "+req.url()+"\n"
            )

        }

    })

    const username = process.env.PORTAL_USERNAME
    const password = process.env.PORTAL_PASSWORD
    const pin = process.env.PORTAL_PIN

    console.log("Apro login")

    await page.goto(
        "https://www.ilportaledellautomobilista.it/web/portale-automobilista/loginspid",
        {waitUntil:"networkidle2"}
    )

    await page.waitForTimeout(4000)

    await page.type('input[type="text"]',username)
    await page.type('input[type="password"]',password)

    await page.click('button[type="submit"],input[type="submit"]')

    await page.waitForNavigation({waitUntil:"networkidle2"})

    console.log("Login completato")

    await page.waitForTimeout(4000)

    console.log("Apro pagina PIN")
    await page.goto(
        "https://www.ilportaledellautomobilista.it/SSO/SSOLogin/DispatcherEntry_executeDispatch.action?goto=http%3A%2F%2Fwww.ilportaledellautomobilista.it%2Fprenotazione",
        {waitUntil:"networkidle2"}
    )

    await page.waitForTimeout(4000)

    await page.type('input[type="text"],input[type="password"]',pin)

    await page.click('button,input[type="submit"]')

    await page.waitForNavigation({waitUntil:"networkidle2"})

    console.log("Entrato nel sistema prenotazioni")

    await page.waitForTimeout(5000)

    await scanPortal(page)

}

start()