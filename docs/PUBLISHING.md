# Выкладка выпусков с цензурой

На сайте лежат только публичные версии выпусков (с чёрными плашками, см. [REDACTION.md](REDACTION.md)). Оригиналы хранятся в приватном бакете `pilot-archive-issues-private` под префиксом `originals/` (тот же ключ, что на сайте) и локально в `~/Downloads/Reading/pilot-archive/`.

## Где что лежит

| Что | Где |
| --- | --- |
| Публичный PDF и обложка | `pilot-archive-public`, ключ из `pdfUrl`/`coverUrl` в `archive/manifest.json` |
| Оригиналы | `pilot-archive-issues-private/originals/<тот же ключ>` |
| Заявки до одобрения | `pilot-archive-issues-private/pending/submissions/…` |
| Распознавание, решения, публичная версия | `~/Downloads/Reading/pilot-archive-fulltext-cache/<год>-<номер>-<серия>/` |

Перед `pilot-archive.ru` стоит Caddy (только журнал для статистики), за ним публичный домен бакета Selectel со своим кэшем. Этот кэш не смотрит на `Cache-Control` файла: после замены файла по тому же адресу кэш нужно сбросить в панели Selectel, иначе посетители ещё долго получают старую версию.

## Замена уже выложенных выпусков

1. Оригиналы скопированы в `originals/` (сделано 16.10.2026 для всех 28 выпусков на сайте):
   ```
   export AWS_PROFILE=selectel AWS_DEFAULT_REGION=ru-6 AWS_CA_BUNDLE=/etc/ssl/cert.pem
   aws --endpoint-url https://s3.ru-6.storage.selcloud.ru s3 cp --recursive \
     s3://pilot-archive-public/archive/ s3://pilot-archive-issues-private/originals/archive/ \
     --exclude '*' --include '*.pdf' --include '*.jpg'
   ```
2. Для каждого выпуска готова публичная версия: `npm run censor -- "<PDF>" --apply`.
3. План: `node scripts/publish-redacted.mjs`. Скрипт сверяет выпуски из манифеста сайта с кэшем и не пускает выпуск без публичной версии, без копии оригинала или с `redactions.json` новее публичной версии.
4. Выкладка: `node scripts/publish-redacted.mjs --apply` (или `--apply 2000-27` для одного выпуска). PDF кладётся по тому же ключу, манифест и D1 не меняются. Обложка пересобирается, только если изменился лист 1.
5. Сбросить кэш публичного домена бакета в панели Selectel (весь домен или пути `/archive/*`).
6. Проверить: `curl -sI https://pilot-archive.ru/<ключ>`, где `content-length` должен совпасть с размером публичной версии; открыть выпуск на сайте и посмотреть закрытое место.

Повторная правка выпуска: поправить `redactions.json`, `censor --apply`, снова шаги 3–6.

## Новый выпуск

Сейчас одобрение в админке копирует загруженный файл из приватного бакета в публичный как есть, поэтому цензура должна произойти **до** нажатия «Одобрить».

1. Куратор загружает PDF через админку. Файл и обложка, созданная браузером из листа 1, лежат в `pending/submissions/<год>/<slug>/<uuid>.pdf` и `….pdf.cover.jpg`. На сайте их нет.
2. Локально: положить оригинал в `~/Downloads/Reading/pilot-archive/` под именем `ПП №NN(SSSS)-Д.ММ.ГГГГ.pdf` и выполнить `npm run censor -- "<PDF>"`. Разобрать находки в `review.html` и просмотреть полосы глазами по [REDACTION.md](REDACTION.md), затем `npm run censor -- "<PDF>" --apply` и `node scripts/check-anchors.mjs <id>`.
3. Сохранить оригинал в `originals/archive/<год>/<slug>/issue-<uuid>.pdf` (ключ, под которым выпуск появится на сайте).
4. Заменить файл заявки публичной версией: `aws s3 cp "<…> (публичная версия).pdf" s3://pilot-archive-issues-private/pending/submissions/<год>/<slug>/<uuid>.pdf --content-type application/pdf`. Если закрыто что-то на листе 1, заменить и обложку `….pdf.cover.jpg` (439 px по ширине, JPEG 85).
5. Нажать «Одобрить». В публичный бакет уйдёт уже цензурированный файл. Новый ключ кэш ещё не видел, поэтому сброс не нужен; манифест обновится, когда истечёт его кэш (или сбросить `/archive/manifest.json`).

Слабое место — шаг 5 можно сделать раньше шага 4, и тогда на сайт уйдёт оригинал. Надёжнее добавить в одобрение проверку: заявку можно одобрить, только если у файла в приватном бакете есть метка `x-amz-meta-redacted` (ставится при загрузке на шаге 4: `--metadata redacted=1`). Тогда выкладка оригинала по ошибке невозможна.

## Что ещё помнить

- `archive-catalog/checksums.json` описывает оригиналы, а не публичные версии.
- Публичный индекс авторов `archive/authors-index.json` содержит фамилии авторов и заголовки статей. Если заголовок или подпись закрыты, их надо убрать и оттуда.
- Удалять из публичного бакета можно только то, что уже есть в `originals/`.
