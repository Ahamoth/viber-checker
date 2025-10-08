const Apify = require('apify');
const { PuppeteerCrawler } = require('apify');

Apify.main(async () => {
  const { phoneNumbers, maxRequests = 100, proxy } = await Apify.getInput() || { phoneNumbers: [] };

  // Если phoneNumbers — URL к CSV, загрузите его (используйте dataset или fetch)
  let numbers = phoneNumbers;
  if (typeof phoneNumbers === 'string' && phoneNumbers.startsWith('http')) {
    const response = await Apify.utils.requestAsBrowser({ url: phoneNumbers });
    // Парсинг CSV (упрощено; используйте csv-parser для реала)
    numbers = response.body.split('\n').map(line => line.trim()).filter(Boolean).slice(0, maxRequests);
  }

  const crawler = new PuppeteerCrawler({
    maxRequestsPerCrawl: maxRequests,
    launchContext: {
      launchOptions: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
      useChrome: true,
      proxy: proxy || undefined,  // Добавьте прокси для избежания банов
    },
    requestHandler: async ({ page, request }) => {
      const phone = request.userData.phone;  // Передаем номер в userData
      const deepLink = `viber://chat?number=${phone.replace('+', '')}`;

      try {
        // Эмулируем мобильный UA для лучшей совместимости
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');
        
        // Открываем deep link (Puppeteer может обрабатывать app schemes через CDP)
        await page.evaluateOnNewDocument(() => {
          // Хак: создаем ссылку и кликаем (для app links)
        });
        await page.goto(`https://www.google.com?q=${encodeURIComponent(deepLink)}`, { waitUntil: 'networkidle2' });  // Альтернатива: через поиск, но лучше direct
        // Лучше: используйте CDP для навигации по scheme
        const client = await page.target().createCDPSession();
        await client.send('Page.navigate', { url: deepLink });

        // Ждем 3-5 сек и проверяем
        await page.waitForTimeout(3000);
        
        // Проверка: ищем признаки чата (адаптируйте под реальные селекторы Viber web или app simulation)
        const isRegistered = await page.evaluate(() => {
          // Если чат открыт: наличие input для сообщений или "Send message" button
          return !!document.querySelector('input[placeholder*="message"]') || !document.querySelector('.error, .not-found');
        });

        await Apify.pushData({
          phone,
          viberRegistered: isRegistered ? 'yes' : 'no',
          timestamp: new Date().toISOString(),
          error: null
        });

      } catch (error) {
        await Apify.pushData({
          phone,
          viberRegistered: 'unknown',
          timestamp: new Date().toISOString(),
          error: error.message
        });
      }
    },
    // Генерируем запросы для каждого номера
    preNavigateOptions: ({ request }) => ({ proxy }),
  });

  // Запускаем для каждого номера
  await crawler.run(numbers.slice(0, maxRequests).map(phone => ({
    url: `data:,${phone}`,  // Dummy URL
    userData: { phone }
  })));

  console.log(`Checked ${numbers.length} numbers. Results in dataset.`);
});
