
 // ResizeObserver loop — известный шум браузера на Nuxt-страницах с анимацией
// фильтров. К доступности сайта отношения не имеет, тест из-за него ронять нельзя.
Cypress.on('uncaught:exception', (err) => {
  if (err.message.includes('ResizeObserver')) return false;
});

describe('E-SIM Search Flow', () => {
  const EMAIL = Cypress.env('LOGIN_EMAIL');
  const PASSWORD = Cypress.env('LOGIN_PASSWORD');

  // Страна поиска
  const COUNTRY = 'Турция';
  const COUNTRY_CODE = 'TR';

  // Карточки тарифов
  const OFFER_CARD = 'main article';

  const T = {
    PAGE: 120000,
    UI: 30000,
    API: 45000,
    SEARCH: 60000,
    RESULTS: 30000,
    LOGOUT: 30000,
    AUTOCOMPLETE: 45000,
  };

  const PAUSE = {
    MODAL: 1000,
    FIELD: 500,
    SUBMIT: 800,
    TAB: 1000,
    SETTLE: 2000,
    AUTOCOMPLETE: 2000,
  };

  before(() => {
    expect(
      EMAIL,
      'секрет CYPRESS_LOGIN_EMAIL не задан'
    ).to.be.a('string').and.not.be.empty;

    expect(
      PASSWORD,
      'секрет CYPRESS_LOGIN_PASSWORD не задан'
    ).to.be.a('string').and.not.be.empty;
  });

  beforeEach(() => {
    cy.writeFile('auth_api_status.txt', 'UNKNOWN');
    cy.writeFile('api_status.txt', 'UNKNOWN');
    cy.writeFile('offers_count.txt', 'N/A');
  });

  it('Login and E-SIM search with Smart Diagnostic', () => {
    cy.viewport(1280, 800);

    // 1. ПЕРЕХВАТ API
    cy.intercept({
      method: 'POST',
      url: '**/login**',
    }).as('apiAuth');

    cy.intercept({
      method: 'POST',
      url: '**/api/v1/search/esim**',
    }).as('apiEsimSearch');

    // 2. ПЕРЕХОД НА ГЛАВНУЮ
    cy.visit('https://metatrip.asia/ru/', {
      timeout: T.PAGE,
    });

    // 3. ОТКРЫТИЕ МОДАЛКИ АВТОРИЗАЦИИ
    cy.clickUntilVisible('nav button', '.p-dialog', {
      text: 'Войти',
      timeout: T.UI,
      pause: PAUSE.MODAL,
    });

    cy.get('.p-dialog', {
      timeout: T.UI,
    })
      .should('be.visible')
      .within(() => {
        cy.contains('Вход в профиль', {
          timeout: T.UI,
        }).should('be.visible');

        // 4. ВВОД EMAIL
        cy.fillInput('input[name="email"]', EMAIL, {
          timeout: T.UI,
        });

        cy.wait(PAUSE.FIELD);

        // 5. ВВОД ПАРОЛЯ
        cy.fillInput('input[name="password"]', PASSWORD, {
          timeout: T.UI,
        });

        cy.wait(PAUSE.SUBMIT);

        // 6. КЛИК ВОЙТИ
        cy.get('button[aria-label="Войти"]', {
          timeout: T.UI,
        })
          .should('be.visible')
          .and('have.attr', 'data-p-disabled', 'false')
          .click({ timeout: T.UI });
      });

    // 7. ПРОВЕРКА ОТВЕТА АВТОРИЗАЦИИ
    cy.wait('@apiAuth', {
      timeout: T.API,
    }).then((interception) => {
      const statusCode = interception.response?.statusCode || 500;

      cy.writeFile('auth_api_status.txt', String(statusCode));

      expect(
        statusCode,
        `Ошибка авторизации: HTTP ${statusCode}`
      ).to.be.within(200, 299);
    });

    // 8. ПРОВЕРКА УСПЕШНОГО ВХОДА
    cy.get('.p-dialog', {
      timeout: T.LOGOUT,
    }).should('not.exist');

    cy.get('body', {
      timeout: T.UI,
    })
      .should('not.contain', 'Неверный логин')
      .and('not.contain', 'Ошибка');

    cy.log('Авторизация прошла успешно');

    // 9. ПЕРЕХОД НА ВКЛАДКУ E-SIM
    cy.clickUntilVisible('button[role="tab"]', '.esim-search', {
      text: /SIM/i,
      timeout: T.UI,
      pause: PAUSE.TAB,
    });

    cy.get('.esim-search', {
      timeout: T.UI,
    }).should('be.visible');

    // 10. ВВОД СТРАНЫ
    // Очищаем поле и вводим текст с небольшой задержкой,
    // чтобы дать автокомплиту обработать ввод.
    cy.get('.esim-search__destination input', {
      timeout: T.UI,
    })
      .should('be.visible')
      .click()
      .clear()
      .type(COUNTRY, {
        delay: 150,
      });

    cy.get('.esim-search__destination input', {
      timeout: T.UI,
    }).should('have.value', COUNTRY);

    // 11. ОЖИДАНИЕ РЕЗУЛЬТАТОВ АВТОКОМПЛИТА
    // PrimeVue может показывать сообщение "Ничего не найдено".
    // Поэтому сначала проверяем наличие вариантов,
    // а не предполагаем, что список уже существует.
    cy.get('body', {
      timeout: T.AUTOCOMPLETE,
    }).should(($body) => {
      const options = $body.find(
        '.p-autocomplete-list [role="option"]'
      );

      const emptyMessage = $body.find(
        '.p-autocomplete-empty-message, .p-autocomplete-empty-message *'
      );

      const hasEmptyText = $body
        .text()
        .includes('Ничего не найдено');

      expect(
        options.length > 0 || emptyMessage.length > 0 || hasEmptyText,
        'Автокомплит должен показать варианты или сообщение об отсутствии результатов'
      ).to.equal(true);
    });

    // Проверяем, появились ли варианты страны.
    cy.get('body').then(($body) => {
      const options = $body.find(
        '.p-autocomplete-list [role="option"]'
      );

      if (options.length === 0) {
        cy.screenshot('esim-autocomplete-no-results', {
          capture: 'viewport',
        });

        throw new Error(
          `Автокомплит не вернул варианты для "${COUNTRY}". ` +
          'На странице отображается "Ничего не найдено". ' +
          'Проверь ответ API автокомплита и формат названия страны.'
        );
      }
    });

    // 12. ВЫБОР СТРАНЫ
    cy.get('.p-autocomplete-list [role="option"]', {
      timeout: T.AUTOCOMPLETE,
    })
      .should('have.length.greaterThan', 0)
      .first()
      .should('be.visible')
      .click({ timeout: T.UI });

    // Проверяем закрытие выпадающего списка.
    // Учитываем, что PrimeVue может удалить список из DOM
    // либо просто скрыть его.
    cy.get('body').should(($body) => {
      const list = $body.find('.p-autocomplete-list:visible');
      expect(list.length).to.equal(0);
    });

    // 13. ЗАПУСК ПОИСКА
    cy.get('.esim-search__submit', {
      timeout: T.UI,
    })
      .should('be.visible')
      .and('not.be.disabled')
      .click({ timeout: T.UI });

    // 14. ПРОВЕРКА ОТВЕТА API ПОИСКА
    cy.wait('@apiEsimSearch', {
      timeout: T.SEARCH,
    }).then((interception) => {
      const statusCode = interception.response?.statusCode || 500;

      cy.writeFile('api_status.txt', String(statusCode));

      expect(
        statusCode,
        `Ошибка поиска E-SIM: HTTP ${statusCode}`
      ).to.be.within(200, 299);
    });

    // 15. ПРОВЕРКА URL
    cy.url({
      timeout: T.SEARCH,
    })
      .should('include', '/esim')
      .and('include', 'searchType=country')
      .and('include', `destination=${COUNTRY_CODE}`);

    // 16. ПОДСЧЁТ ОФФЕРОВ
    // Ждём, пока число карточек стабилизируется.
    cy.countWhenStable(OFFER_CARD, {
      timeout: T.RESULTS,
      settle: PAUSE.SETTLE,
    }).then((count) => {
      cy.writeFile('offers_count.txt', String(count));

      cy.log(`Найдено офферов E-SIM (${COUNTRY}): ${count}`);

      expect(
        count,
        `Количество офферов для ${COUNTRY}`
      ).to.be.greaterThan(0);
    });

    // 17. СКРИНШОТ РЕЗУЛЬТАТОВ
    cy.screenshot('after-search', {
      capture: 'viewport',
    });
  });
});
