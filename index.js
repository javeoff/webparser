const fs = require('fs');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const HttpsProxyAgent = require('https-proxy-agent');

const db = require('./data.json');
const proxies = fs.readFileSync('./proxy.txt').toString().split('\n');

counter = 0
i = 0

function* getProxy() {
    for (let i = 0; i < proxies.length; i++) {
        //console.log(proxies[i])
        if (i == proxies.length) i = 0
        yield proxies[i];
    }
}

class Page {
    constructor(url, proxy) {
        this.url = url
        this.proxy = proxy
        if (proxy) this.proxy = getProxy()
    }

    fetch_async = () => {
        return fetch => new Promise((resolve, reject) => {
            const countdown = setTimeout(() => {
                if (this.proxy) reject(new Error('Время истекло'))
                return
            }, 1000)

            fetch.then(async response => {
                if (response.status === 200) {
                    clearTimeout(countdown)
                    response = await response.text()
                    resolve(response)
                    return response
                }

                reject(new Error(response.statusText))
            })
            .catch((e) => {
                clearTimeout(countdown)
                reject(new Error(e));
            })
        })
    }

    fetch_web = async () => {
        return new Promise(async resolve => {
            var res;
            var Headers 
            if (this.proxy) {
                const ip = this.proxy.next().value
                Headers = {
                    agent: new HttpsProxyAgent(`http://${ip}`)
                }
            }
            else Headers = {}
    
            try {
                res = await this.fetch_async()(fetch(this.url, Headers))
            }
            catch (e) {
                console.error(e.message)
                //if (e.message === "Время истекло")
                this.fetch_web()
                return
            }

            resolve(res)
        })
    }
}

class Grabber {
    constructor(page) {
        this.page = page
    }

    init() {
        return new Promise(resolve => {
            this.$ = cheerio.load(this.page)
            resolve(this)
        })
    }

    text(elem) {
        return this.$(elem).text() ? this.$(elem).text() : ''
    }

    arrText(elem, count=1, type = "text") {
        const arr = []
        const $ = this.$

        this.$(elem).each(function (i, elem) {
            if (i < count) {
                if (type == "text") arr.push($(this).text())
                else if (type == "img") arr.push($(this).attr('src'))
                else if (type == "link") arr.push($(this).attr('href'))
                else arr.push($(this).text())
            }
          })
        return arr
    }

    link(elem) {
        // Если ссылка одна
        return this.$(elem).attr('href')
    }

    arrLink(elem) {
        // Если надо взять много ссылок по дереву
        const arr = []
        const $ = this.$

        this.$(elem).each(function (i, elem) {
            arr.push($(this).attr('href'))
        })
        return arr
    }
}

async function initDB(data, parent) {
    return new Promise( resolve => {
        for (let i = 0; i < Object.keys(data).length; i++) {
            const url = Object.keys(data)[i];
            const transform = new Page(url, false) // 2 параметр - прокси выключены
            transform.fetch_web().then(async html => {
                const grab = await new Grabber(html).init()
                // сделал Grabber инит через промис на всякий случай, но без промиса все также работает

                const info = data[url]

                for (let x = 0; x < Object.keys(info).length; x++) {
                    const prop = Object.keys(info)[x];

                    if (prop[0] == '.') {
                        var links = grab.arrLink(prop)
                        var limit = links.length
                        let current = {...info[prop]}

                        if (info[prop] instanceof Array === true) {
                            // Вариант итерации ссылок с лимитом - ".link":[данные на страницу, кол-во страниц]
                            limit = info[prop][1]
                            current = {...info[prop][0]}
                        }

                        for (let y = 0; y < limit; y++) {
                            // Перебор ссылок и получение по ним нового контента

                            var link = links[y];
                            if (!link.includes('http')) {
                                if (url.endsWith('/')) link = url.slice(0, -1)+link
                                else link = url+''+link
                            }
                            else link = url+''+link
                            
                            // Подгатавливаем объект для повторной инициализации новой страницы
                            const inited = {}
                            inited[link] = {...current}

                            // Заново запускаем подготовленный под инициализацию объект
                            let obj = await initDB(inited, current)
                            data[url][links[y]] = Object.values(obj)[0]
                        }

                        delete info[prop]
                        continue
                    }
                    else if (info[prop] instanceof Array == true) {
                        // Если хотим получить 1 или несколько элементов на странице
                        info[prop] = grab.arrText(info[prop][0], info[prop][1], info[prop][2])
                    }
                    else if (prop[0] !== '/' ) {
                        // Чтобы увидеть ошибку убрать условие и оставить только else
                        // Если указан класс, а не текст
                        // info[prop] перезаписывается при новом initDB() строка:160
                        // info[prop] сначала dom, а пото становится результатом первого инита
                        // Получает текст из DOM дерева страницы
                        if (parent) {
                            console.log('parent', parent[prop]);
                            info[prop] = grab.text(parent[prop])
                        }
                        else info[prop] = grab.text(info[prop])
                    }
                }

                console.log(data);
                resolve(data)
            })
        }
    })
}


async function x() {
    const data = await initDB(db)
    fs.writeFileSync('res.json', JSON.stringify(data))
}

x()
