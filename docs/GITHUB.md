# GitHub workflow

Репозиторий: `git@github.com:sbadulin/pilot-archive.git`.

Работать в ветках, открывать pull request в `main`. Проверка `Tests and builds` запускает TypeScript, тесты, проверку восьми исходных PDF и обе сборки. После merge `Deploy production` повторяет проверку и публикует frontend в Selectel S3, админку — в Pages.

До первого merge, который должен деплоиться, настроить GitHub Environments:

| Environment | Secrets | Variables |
| --- | --- | --- |
| `selectel-production` | `SELECTEL_ACCESS_KEY`, `SELECTEL_SECRET_KEY` | `SELECTEL_ENDPOINT`, `SELECTEL_REGION`, `SELECTEL_PUBLIC_BUCKET` |
| `cloudflare-production` | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | — |

Selectel-ключ предназначен для публичного бакета. Ключ доступа backend к приватным заявкам в этом workflow не используется. Cloudflare token должен иметь доступ на публикацию Pages в нужном аккаунте.

Для `main` включить правило: изменения только через PR, обязательный успешный `Tests and builds`, запрет force push и удаления. Включить удаление ветки после merge. Требование отдельного reviewer — по составу команды; для единственного разработчика оно может блокировать собственные PR.

Не применять миграции D1 автоматически при каждом деплое: это отдельная операция с резервной копией и проверкой совместимости. Секреты приложения, D1 и R2 остаются настроенными в Cloudflare.

Сначала поднять публичный S3 и российский HTTPS-вход по плейбуку. Деплой не создаёт платные ресурсы и не переключает DNS. Без настроенных Secrets/Variables workflow завершится ошибкой, а не отметит пустой деплой успешным.

Публикация выпусков — отдельный процесс backend. Workflow интерфейса не отправляет `archive-data` и не применяет `--delete` к бакету. Существующие PDF, каталог и старые хешированные JS остаются на месте.

При первом запуске отдельно загрузить `archive-data/archive/` в `archive/` публичного бакета и проверить контрольные суммы. Не перезаписывать живой manifest файлом из локальной копии, если там уже есть новые выпуски.

CLI для настройки правил после первого успешного PR-check:

```sh
bash scripts/configure-github.sh
gh secret set SELECTEL_ACCESS_KEY --env selectel-production --repo sbadulin/pilot-archive
gh secret set SELECTEL_SECRET_KEY --env selectel-production --repo sbadulin/pilot-archive
gh variable set SELECTEL_ENDPOINT --env selectel-production --repo sbadulin/pilot-archive
gh variable set SELECTEL_REGION --env selectel-production --repo sbadulin/pilot-archive
gh variable set SELECTEL_PUBLIC_BUCKET --env selectel-production --repo sbadulin/pilot-archive
gh secret set CLOUDFLARE_API_TOKEN --env cloudflare-production --repo sbadulin/pilot-archive
gh secret set CLOUDFLARE_ACCOUNT_ID --env cloudflare-production --repo sbadulin/pilot-archive
```

Команды запрашивают значения интерактивно. Не вписывать ключи в команды, коммиты или PR.
Если GitHub отказывает в настройке environments/защиты из-за тарифа приватного репозитория, не менять его видимость автоматически: потребуется поддерживаемый тариф либо согласованное упрощение правил.
