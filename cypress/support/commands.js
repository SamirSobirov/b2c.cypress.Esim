// ***********************************************
// Кастомные команды проекта
// https://on.cypress.io/custom-commands
// ***********************************************

/**
 * Надёжный ввод в поля PrimeVue/Vue.
 *
 * Проблема: после ввода в соседнее поле Vue пересоздаёт ноду инпута.
 * Cypress печатает в старый (отсоединённый) элемент — без ошибки, но и без
 * результата: поле остаётся пустым. Проверено на форме входа metatrip.asia —
 * первый .type() в поле пароля теряется целиком, второй проходит.
 *
 * Решение: перезапрашивать элемент перед каждым действием и повторять ввод,
 * пока значение реально не окажется в поле.
 *
 * @param {string} selector — CSS-селектор поля (учитывает scope cy.within)
 * @param {string} value    — значение для ввода
 * @param {object} options  — { attempts: number, timeout: number, pause: number }
 */
Cypress.Commands.add('fillInput', (selector, value, options = {}) => {
  // timeout с запасом: на медленном CI-раннере поле появляется не мгновенно
  // pause — видимая в логе пауза, даёт Vue доперерисовать ноду перед вводом
  const { attempts = 4, timeout = 30000, pause = 300 } = options;

  const attempt = (n) => {
    // каждый шаг — со свежим запросом ноды, чтобы не попасть в detached-элемент.
    // timeout нужен и самим экшенам: у clear/type свой лимит на проверку
    // actionability (поле видимо, не перекрыто, не анимируется).
    cy.get(selector, { timeout }).should('be.visible').clear({ timeout, log: false });
    cy.wait(pause);
    cy.get(selector, { timeout }).type(value, { timeout, delay: 0, log: false });
    cy.wait(pause);

    cy.get(selector, { timeout }).then(($el) => {
      if ($el.val() === value) return;

      if (n >= attempts) {
        throw new Error(
          `🆘 Не удалось заполнить "${selector}" за ${attempts} попыт(ок): ` +
          `в поле "${$el.val()}"`
        );
      }
      attempt(n + 1);
    });
  };

  attempt(1);
});

/**
 * Клик по триггеру с повтором, пока в DOM не появится целевой элемент.
 *
 * Проблема: metatrip.asia — Nuxt с SSR. Разметка приходит с сервера, поэтому
 * кнопка видима и кликабельна ещё до того, как Vue навесит на неё обработчики
 * (гидратация). Клик в этот момент проходит без ошибки, но ничего не открывает.
 * Локально гидратация занимает доли секунды, на раннере GitHub Actions заметно
 * дольше — отсюда падение `expected .p-dialog to be visible` при 0 элементов.
 *
 * Решение: кликать повторно, пока целевой элемент не появится. Как только он
 * есть — выходим, так что лишнего клика (который закрыл бы модалку) не будет.
 *
 * Ограничение задано временем, а не числом попыток: сколько именно кликов
 * потребуется, зависит от скорости раннера, и фиксированный счётчик пришлось бы
 * подбирать вслепую. Проверено маркерами Nuxt (__NUXT__, useNuxtApp) — оба
 * доступны ещё до гидратации, так что дождаться её по признаку нельзя.
 *
 * @param {string} trigger — CSS-селектор кликаемого элемента
 * @param {string} target  — что должно появиться в DOM после клика
 * @param {object} options — { timeout, pause, text }
 *                           timeout — общий бюджет на все попытки
 *                           text    — искать триггер по тексту (cy.contains)
 */
Cypress.Commands.add('clickUntilVisible', (trigger, target, options = {}) => {
  const { timeout = 30000, pause = 1000, text = null } = options;

  const deadline = Date.now() + timeout;
  let clicks = 0;

  const attempt = () => {
    const $trigger = text
      ? cy.contains(trigger, text, { timeout })
      : cy.get(trigger, { timeout });

    $trigger.should('be.visible').click({ timeout });
    clicks += 1;
    cy.wait(pause);

    cy.get('body').then(($body) => {
      if ($body.find(target).length > 0) return;

      if (Date.now() >= deadline) {
        throw new Error(
          `🆘 "${target}" не появился после ${clicks} клик(ов) по "${trigger}"` +
          (text ? ` с текстом "${text}"` : '') +
          ` за ${timeout} мс — вероятно, страница не догрузилась`
        );
      }
      attempt();
    });
  };

  attempt();
});
