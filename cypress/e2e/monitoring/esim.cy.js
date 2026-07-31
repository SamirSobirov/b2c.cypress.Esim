// ResizeObserver loop — известный шум браузера на Nuxt-страницах с анимацией
// фильтров. К доступности сайта отношения не имеет, тест из-за него ронять нельзя.
Cypress.on('uncaught:exception', (err) => {
  if (err.message.includes('ResizeObserver')) return false;
});

describe('E-SIM Search Flow', () => {

  const EMAIL = Cypress.env('LOGIN_EMAIL');
  const PASSWORD = Cypress.env('LOGIN_PASSWORD');

  // Страна поиска. CODE — то, что сайт кладёт в query-параметр destination
  const COUNTRY = 'Турция';
  const COUNTRY_CODE = 'TR';

  // Проверено на выдаче: 16 article = 16 карточек тарифов, других article
  // внутри main нет (фильтры слева — это div'ы).
  const OFFER_CARD = 'main article';

  const T = {
    PAGE: 120000,
    UI: 30000,
    API: 45000,
    SEARCH: 60000,
    RESULTS: 30000,
    LOGOUT: 30000,
  };

  const PAUSE = {
    MODAL: 1000,
    FIELD: 500,
    SUBMIT: 800,
    TAB: 1000,
    SETTLE: 2000,
  };

  before(() => {
    expect(EMAIL, 'секрет CYPRESS_LOGIN_EMAIL не задан').to.be.a('string').and.not.be.empty;
    expect(PASSWORD, 'секрет CYPRESS_LOGIN_PASSWORD не задан').to.be.a('string').and.not.be.empty;
  });

  beforeEach(() => {
    cy.writeFile('auth_api_status.txt', 'UNKNOWN');
    cy.writeFile('api_status.txt', 'UNKNOWN');
    cy.writeFile('offers_count.txt', 'N/A');
  });

  // Авторизация и поиск — один тест, а не два: между тестами Cypress чистит
  // куки и localStorage (test isolation), и вторая часть осталась бы без сессии.
  it('Login and E-SIM search with Smart Diagnostic', () => {
    cy.viewport(1280, 800);

    // 1. ПЕРЕХВАТ API
    cy.intercept({ method: 'POST', url: '**/login**' }).as('apiAuth');
    cy.intercept({ method: 'POST', url: '**/api/v1/search/esim**' }).as('apiEsimSearch');

    // 2. ПЕРЕХОД НА ГЛАВНУЮ
    cy.visit('https://metatrip.asia/ru/', { timeout: T.PAGE });

    // 3. ОТКРЫТИЕ МОДАЛКИ "ВХОД В ПРОФИЛЬ"
    // Клик с повтором: страница на Nuxt приходит с сервера уже отрисованной,
    // и до окончания гидратации кнопка кликается вхолостую — модалка не встаёт.
    // На раннере GitHub Actions это ловилось стабильно, локально почти никогда.
    cy.clickUntilVisible('nav button', '.p-dialog', {
      text: 'Войти',
      timeout: T.UI,
      pause: PAUSE.MODAL,
    });

    cy.get('.p-dialog', { timeout: T.UI }).should('be.visible').within(() => {
      cy.contains('Вход в профиль', { timeout: T.UI }).should('be.visible');

      // 4. ВВОД ПОЧТЫ
      cy.fillInput('input[name="email"]', EMAIL, { timeout: T.UI });
      cy.wait(PAUSE.FIELD);

      // 5. ВВОД ПАРОЛЯ
      cy.fillInput('input[name="password"]', PASSWORD, { timeout: T.UI });
      cy.wait(PAUSE.SUBMIT);

      // 6. КЛИК "ВОЙТИ"
      cy.get('button[aria-label="Войти"]', { timeout: T.UI })
        .should('be.visible')
        .and('have.attr', 'data-p-disabled', 'false')
        .click({ timeout: T.UI });
    });

    // 7. УМНАЯ ПРОВЕРКА ОТВЕТА СЕРВЕРА
    cy.wait('@apiAuth', { timeout: T.API }).then((interception) => {
      const statusCode = interception.response?.statusCode || 500;
      cy.writeFile('auth_api_status.txt', statusCode.toString());

      if (statusCode >= 400) {
        throw new Error(`🆘 Ошибка сервера при авторизации: HTTP ${statusCode}`);
      }
    });

    // 8. ПРОВЕРКА УСПЕШНОГО ВХОДА (UI)
    cy.get('.p-dialog', { timeout: T.LOGOUT }).should('not.exist');
    cy.get('body', { timeout: T.UI })
      .should('not.contain', 'Неверный логин')
      .and('not.contain', 'Ошибка');

    cy.log('✅ Авторизация прошла успешно');

    // 9. ВКЛАДКА "E-SIM" НА ГЛАВНОЙ
    // Ищем по /SIM/, а не по строке "E-SIM": в вёрстке первая буква —
    // кириллическая «Е» (U+0415), поиск по латинскому "E-SIM" не находит вкладку.
    // Клик с повтором: форма поиска монтируется только после гидратации вкладок.
    cy.clickUntilVisible('button[role="tab"]', '.esim-search', {
      text: /SIM/i,
      timeout: T.UI,
      pause: PAUSE.TAB,
    });

    cy.get('.esim-search', { timeout: T.UI }).should('be.visible');

    // 10. ВВОД СТРАНЫ В АВТОКОМПЛИТ
    // fillInput перезапрашивает ноду и повторяет ввод: PrimeVue пересоздаёт
    // инпут при переключении вкладки, и первый .type() уходит в пустоту.
    cy.fillInput('.esim-search__destination input', COUNTRY, { timeout: T.UI });

    // 11. ВЫБОР ПЕРВОГО ВАРИАНТА ИЗ ВЫПАДАЮЩЕГО СПИСКА
    cy.get('.p-autocomplete-list [role="option"]', { timeout: T.UI })
      .should('have.length.greaterThan', 0)
      .first()
      .should('be.visible')
      .click({ timeout: T.UI });

    cy.get('.p-autocomplete-list', { timeout: T.UI }).should('not.exist');

    // 12. ПОИСК
    cy.get('.esim-search__submit', { timeout: T.UI })
      .should('be.visible')
      .and('not.be.disabled')
      .click({ timeout: T.UI });

    // 13. УМНАЯ ПРОВЕРКА ОТВЕТА ПОИСКА
    cy.wait('@apiEsimSearch', { timeout: T.SEARCH }).then((interception) => {
      const statusCode = interception.response?.statusCode || 500;
      cy.writeFile('api_status.txt', statusCode.toString());

      if (statusCode >= 400) {
        throw new Error(`🆘 Ошибка сервера при поиске E-SIM: HTTP ${statusCode}`);
      }
    });

    // 14. ПРОВЕРКА, ЧТО ИСКАЛИ ИМЕННО ВЫБРАННУЮ СТРАНУ
    // Страна попадает в URL кодом (Турция → TR) — заодно ловим случай,
    // когда из списка кликнулся не тот вариант.
    cy.url({ timeout: T.SEARCH })
      .should('include', '/esim')
      .and('include', 'searchType=country')
      .and('include', `destination=${COUNTRY_CODE}`);

    // 15. ПОДСЧЁТ ОФФЕРОВ
    // Берём не первое значение, а стабилизировавшееся: карточки дорисовываются
    // после гидратации, иначе в отчёт попадёт случайное число.
    // Число пишем в файл до проверки: при пустой выдаче отчёт должен показать
    // "⚪ No Offers" с нулём, а не "🔴 Unknown Test Failure" без числа.
    cy.countWhenStable(OFFER_CARD, { timeout: T.RESULTS, settle: PAUSE.SETTLE }).then((count) => {
      cy.writeFile('offers_count.txt', count.toString());
      cy.log(`✅ Найдено офферов E-SIM (${COUNTRY}): ${count}`);

      expect(count, 'офферов в выдаче').to.be.greaterThan(0);
    });

    cy.screenshot('after-search', { capture: 'viewport' });
  });
});
