import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraphicsSite, fallbackTitle, type CatalogGraphic, type CatalogIssue } from '../src/artistGraphics.ts';

const graphic = (sheet: number, n: number, veselov: CatalogGraphic['veselov'], what = 'рисунок: панк у стены'): CatalogGraphic =>
  ({ sheet, box: [100, 200, 900, 1300], kind: 'drawing', what, veselov, crop: `crops/2000-10-0075-s${String(sheet).padStart(2, '0')}-${n}.jpg` });
const issue = (graphics: CatalogGraphic[]): CatalogIssue =>
  ({ issue: '2000-10-0075', sheets: 19, spreads: [10], graphics, size: () => [1000, 2000] });

test('an artist gets marked drawings and hand-picked ones, not excluded or unmarked ones', () => {
  const site = buildGraphicsSite(
    [issue([graphic(3, 1, 'yes'), graphic(14, 2, 'maybe'), graphic(15, 1, 'yes'), graphic(16, 1, 'no'), graphic(4, 1, 'yes')])],
    { artists: [{ name: 'Захар ВЕСЕЛОВ', auto: 'veselov', include: ['2000-10-0075-s14-2'], exclude: ['2000-10-0075-s04-1'] }], titles: { '2000-10-0075-s03-1': 'Панк' } },
  );
  const [artist] = site.artists;
  assert.equal(artist.key, 'захар веселов');
  assert.deepEqual(artist.drawings.map((d) => d.id), ['2000-10-0075-s03-1', '2000-10-0075-s14-2', '2000-10-0075-s15-1']);
  // A spread on sheet 10 shifts later sheets by one printed page.
  assert.deepEqual(artist.drawings.map((d) => d.page), [3, 15, 16]);
  assert.equal(artist.drawings[0].title, 'Панк');
  assert.equal(artist.drawings[1].title, 'Панк у стены');
  assert.deepEqual(artist.drawings[0].box, [0.1, 0.1, 0.9, 0.65]);
});

test('an artist without drawings is left out', () => {
  assert.deepEqual(buildGraphicsSite([issue([graphic(3, 1, 'no')])], { artists: [{ name: 'Кто-то', auto: 'veselov' }] }).artists, []);
});

test('a fallback title drops the cataloguer’s kind prefix', () => {
  assert.equal(fallbackTitle('Карандашный рисунок: девушка с зонтом'), 'Девушка с зонтом');
  assert.equal(fallbackTitle('шарж: астролог в колпаке'), 'Астролог в колпаке');
  assert.equal(fallbackTitle('Дракон читает газету «Пилот»: обложка'), 'Дракон читает газету «Пилот»: обложка');
});
