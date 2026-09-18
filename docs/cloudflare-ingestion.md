# Настройка защищённой загрузки выпусков

## 1. Создать хранилища

```bash
wrangler d1 create pilot_archive
wrangler r2 bucket create pilot-archive-issues
```

Скопируйте `database_id` из ответа `wrangler d1 create` в `wrangler.toml` вместо `REPLACE_WITH_D1_DATABASE_ID`.

## 2. Выполнить миграцию

```bash
wrangler d1 migrations apply pilot_archive --remote
```

## 3. Настроить роли и блокировки

В настройках Pages проекта добавьте Variables and Secrets для production:

```text
PUBLIC_SUBMISSIONS=true
CURATOR_EMAILS=owner@example.com
BANNED_EMAILS=blocked@example.com
```

При `PUBLIC_SUBMISSIONS=true` любой пользователь, прошедший Cloudflare Access, может отправить PDF. `CURATOR_EMAILS` сохраняет права кураторской очереди. `BANNED_EMAILS` блокирует адреса даже после успешного входа. Значения разделяются запятыми, email сравниваются без учёта регистра. `VOLUNTEER_EMAILS` можно оставить для обратной совместимости, но при открытой отправке он больше не нужен.

## 4. Привязать D1 и R2

`wrangler.toml` использует bindings `DB` и `ISSUES_BUCKET`. В Dashboard это соответствует Settings → Bindings → D1 database и R2 bucket.

## 5. Ограничить доступ Cloudflare Access

Создайте Access application для `/admin/*` и `/api/admin/*`. Allow policy должна разрешать вход всем подтверждённым пользователям, которым вы готовы принимать материалы (например, Include → Login Methods → One-time PIN). Роль куратора всё равно определяется сервером через `CURATOR_EMAILS`, а заблокированные адреса отсекаются приложением через `BANNED_EMAILS`.

## 6. Деплой

```bash
wrangler pages deploy dist --project-name pilot-archive
```

Pages Functions попадут в тот же деплой, если команда запускается из корня проекта и рядом лежит каталог `functions/`.

## Проверка

- Посетитель получает только публичную часть архива.
- Приглашённый волонтёр отправляет PDF и получает статус `pending`.
- Куратор видит очередь и может одобрить или отклонить заявку.
- `GET /api/issues` возвращает только записи `approved`.

## 7. Прямая загрузка в Selectel S3

Если задать все четыре production-секрета, браузер будет загружать PDF напрямую в Selectel по временной подписанной ссылке. Без них автоматически используется старый R2-путь.

```bash
printf '%s' 'https://s3.ru-3.storage.selcloud.ru' | wrangler pages secret put SELECTEL_S3_ENDPOINT --project-name pilot-archive
printf '%s' 'pilot-archive-issues-private' | wrangler pages secret put SELECTEL_S3_BUCKET --project-name pilot-archive
printf '%s' 'pilot-archive-public' | wrangler pages secret put SELECTEL_S3_PUBLIC_BUCKET --project-name pilot-archive
printf '%s' '...' | wrangler pages secret put SELECTEL_S3_ACCESS_KEY --project-name pilot-archive
printf '%s' '...' | wrangler pages secret put SELECTEL_S3_SECRET_KEY --project-name pilot-archive
printf '%s' 'ru-3' | wrangler pages secret put SELECTEL_S3_REGION --project-name pilot-archive
```

Создайте два бакета: приватный для заявок и публичный для опубликованных файлов и статической витрины.

На приватном бакете Selectel нужно разрешить CORS для `https://pilot-archive.ru` и `https://pilot-archive.pages.dev`, методы `GET`, `HEAD`, `PUT`, заголовок `Content-Type`. Постоянные ключи S3 в браузер не попадают.

Объекты заявки и JPEG-миниатюра обложки размещаются в `pending/` приватного бакета. После одобрения API копирует их в публичный бакет, в то же дерево `archive/<год>/issue-NN-SSSS/`, где лежат мигрированные оригиналы: PDF как `issue-<id заявки>.pdf`, обложка как `cover-<id заявки>.jpg`. Идентификатор заявки в имени не даёт переизданию затереть оригинал. После отклонения объекты уезжают в `rejected/` приватного бакета; для `rejected/` рекомендуется включить в Selectel lifecycle-правило удаления через 7 дней.

Разделение на проверенное и непроверенное обеспечивает бакет, а не префикс: `pending/` и `rejected/` живут только в приватном бакете и наружу не видны. Отдельного префикса `published/` больше нет — в публичном бакете он ничего не охранял и лишь дробил архив на два дерева.

`archive/manifest.json` — единственный каталог витрины. Он всегда собирается как `archive-catalog/manifest.json` плюс одобренные заявки поверх, по ключу год/номер/сквозной номер: пересборка только из таблицы заявок стёрла бы весь мигрированный архив.

Для обновления российской витрины задайте публичный адрес корня Selectel CDN. После одобрения API запишет туда `archive/manifest.json` и положит PDF в `archive/`:

```bash
printf '%s' 'https://pilot-archive.ru' | wrangler pages secret put SELECTEL_PUBLIC_BASE_URL --project-name pilot-archive
```

В публичном бакете или CDN должны быть доступны на чтение `archive/manifest.json` и объекты `archive/**`. `pending/**` и `rejected/**` остаются в приватном бакете и наружу не публикуются.

Перенос ранее опубликованных заявок из старого дерева `published/submissions/**` выполняется один раз: `npm run archive:migrate -- --apply`, затем `npm run manifest:rebuild -- --apply`, затем `npm run archive:migrate -- --cleanup`. Копирование идёт перед удалением, поэтому выпуски остаются доступны на всём протяжении переноса.

При размещении фронтенда в Selectel замените значение в `dist/runtime-config.js`:

```js
window.PILOT_API_ORIGIN = 'https://pilot-archive.pages.dev';
```

В версии, которая остаётся на Cloudflare Pages, оставьте пустую строку. Административные действия из российской витрины требуют доступности Cloudflare API и активной сессии Access; при проблемах с сетью используйте `pilot-archive.pages.dev` через VPN.
