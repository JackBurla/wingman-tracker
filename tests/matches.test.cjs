const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const fixtures = [
  { game: 1, t1p1: 'Jack', t1p2: 'Jake', t2p1: 'George', t2p2: 'Matt', result: 'win' },
  { game: 2, t1p1: 'Jack', t1p2: 'Jake', t2p1: 'George', t2p2: 'Matt', result: 'tie' },
  { game: 3, t1p1: 'Jeremy', t1p2: 'Thomas', t1p3: 'Jack', t2p1: 'Curtis', t2p2: 'Tom', t2p3: 'Tommy', result: 'win', created_at: '2026-09-27T18:00:00Z' },
  { game: 4, t1p1: 'Jeremy', t1p2: 'Thomas', t1p3: 'Jack', t2p1: 'Curtis', t2p2: 'Tom', t2p3: 'Tommy', result: 'tie', created_at: '2026-09-27T18:30:00Z' }
];

async function app(initialRows = fixtures) {
  const elements = new Map();
  const saved = structuredClone(initialRows);
  const inserted = [];
  const deleted = [];
  const alerts = [];
  let insertError = null;
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: id === 'match-mode' ? '2' : id === 'player-sort' ? 'winpct' : '',
      innerHTML: '', textContent: '', style: {}, checked: true,
      classList: { add() {}, remove() {} }, setAttribute() {}
    });
    return elements.get(id);
  }
  const client = {
    from(table) {
      assert.equal(table, 'matches');
      return {
        select() { return { order: async () => ({ data: structuredClone(saved), error: null }) }; },
        async insert(value) {
          if (insertError) return { error: insertError };
          const rows = structuredClone(Array.isArray(value) ? value : [value]);
          inserted.push(...rows);
          saved.push(...rows);
          return { error: null };
        },
        delete() { return { gte: async () => { deleted.push(true); saved.length = 0; return { error: null }; } }; }
      };
    },
    channel() { return { on() { return this; }, subscribe() {} }; }
  };
  const context = vm.createContext({
    supabase: { createClient: () => client },
    document: { getElementById: element, querySelector: () => null, querySelectorAll: () => [] },
    console: { error() {} }, setTimeout: () => 1, clearTimeout() {},
    alert: message => alerts.push(message), confirm: () => true
  });
  vm.runInContext(source, context);
  await vm.runInContext('load()', context);
  const run = expression => vm.runInContext(expression, context);
  const json = expression => JSON.parse(run(`JSON.stringify(${expression})`));
  function mode(size) { element('match-mode').value = String(size); run('setMatchMode()'); }
  return { run, json, mode, element, saved, inserted, deleted, alerts, failInsert: () => { insertError = { message: 'offline' }; } };
}

test('existing 2v2 matches load without third-player fields and stay separate', async () => {
  const a = await app();
  assert.equal(a.json('matchesForMode()').length, 2);
  assert.deepEqual(a.json('computeStats()["Jack & Jake"]'), { w: 1, l: 0, t: 1 });
  assert.equal(Object.keys(a.json('computeStats()')).length, 45);
  assert.equal(a.json('computePlayerStats().Jeremy').w, 0);
});

test('3v3 counts full trios, all six players, and both teammates', async () => {
  const a = await app();
  a.mode(3);
  assert.equal(a.json('matchesForMode()').length, 2);
  assert.equal(Object.keys(a.json('computeStats()')).length, 120);
  assert.deepEqual(a.json('computeStats()["Jack & Jeremy & Thomas"]'), { w: 1, l: 0, t: 1 });
  assert.deepEqual(a.json('computePlayerStats().Jeremy'), { w: 1, l: 0, t: 1, partners: { Thomas: 1, Jack: 1 } });
  assert.deepEqual(a.json('computePlayerStats().Tommy'), { w: 0, l: 1, t: 1, partners: { Curtis: 0, Tom: 0 } });
  a.run('renderPlayers()');
  assert.match(a.element('players-body').innerHTML, /75%/);
});

test('leaderboards render all three names and filter Tom exactly', async () => {
  const a = await app();
  a.mode(3);
  a.run('renderLB()');
  assert.match(a.element('lb-body').innerHTML, /Jack <span class="amp">&amp;<\/span> Jeremy <span class="amp">&amp;<\/span> Thomas/);
  assert.match(a.element('stats-bar').innerHTML, /<strong>2<\/strong>Games played/);
  a.mode(2);
  a.element('filter-player').value = 'Tom';
  a.element('hide-unplayed').checked = false;
  a.run('renderLB()');
  assert.equal((a.element('lb-body').innerHTML.match(/<tr class=/g) || []).length, 9);
});

test('3v3 match history searches either third player and keeps timestamps', async () => {
  const a = await app();
  a.mode(3);
  a.element('log-search').value = 'Tommy';
  a.run('renderLog()');
  const output = a.element('log-body').innerHTML;
  assert.equal((output.match(/class="log-entry"/g) || []).length, 2);
  assert.match(output, /Jeremy &amp; Thomas &amp; Jack/);
  assert.match(output, /Curtis &amp; Tom &amp; Tommy/);
  assert.doesNotMatch(output, /No timestamp/);
});

test('3v3 validates all six slots and rejects a repeated player', async () => {
  const a = await app([]);
  a.mode(3);
  for (const [key, value] of Object.entries(fixtures[2])) if (/^t\dp\d$/.test(key)) a.element(key).value = value;
  a.element('t2p3').value = '';
  await a.run("recordResult('win')");
  assert.equal(a.element('rec-err').textContent, 'Select all 6 players.');
  a.element('t2p3').value = 'Jeremy';
  await a.run("recordResult('win')");
  assert.equal(a.element('rec-err').textContent, 'All 6 players must be different.');
  assert.equal(a.inserted.length, 0);
});

test('3v3 win saves one row with six names and reloads into stats', async () => {
  const a = await app(fixtures.slice(0, 2));
  a.mode(3);
  for (const [key, value] of Object.entries(fixtures[2])) if (/^t\dp\d$/.test(key)) a.element(key).value = value;
  await a.run("recordResult('win')");
  assert.equal(a.inserted.length, 1);
  assert.deepEqual(a.inserted[0], { game: 3, result: 'win', t1p1: 'Jeremy', t1p2: 'Thomas', t1p3: 'Jack', t2p1: 'Curtis', t2p2: 'Tom', t2p3: 'Tommy' });
  assert.equal(a.json('computePlayerStats().Tommy').l, 1);
  assert.equal(a.element('t1p3').value, '');
  a.mode(2);
  assert.equal(a.json('matchesForMode()').length, 2);
});

test('switching back to 2v2 hides and clears third players before saving a tie', async () => {
  const a = await app([]);
  a.mode(3);
  a.element('t1p3').value = 'Jeremy';
  a.element('t2p3').value = 'Thomas';
  a.mode(2);
  assert.equal(a.element('t1p3').hidden, true);
  assert.equal(a.element('t2p3').disabled, true);
  assert.equal(a.element('t1p3').value, '');
  for (const [key, value] of Object.entries(fixtures[0])) if (/^t\dp\d$/.test(key)) a.element(key).value = value;
  await a.run("recordResult('tie')");
  assert.equal(a.inserted[0].result, 'tie');
  assert.equal('t1p3' in a.inserted[0], false);
  assert.equal(a.json('computePlayerStats().Jack').t, 1);
});

test('save failures preserve selections and show an actionable error', async () => {
  const a = await app([]);
  a.failInsert();
  for (const [key, value] of Object.entries(fixtures[0])) if (/^t\dp\d$/.test(key)) a.element(key).value = value;
  await a.run("recordResult('win')");
  assert.match(a.element('rec-err').textContent, /Could not save/);
  assert.equal(a.element('t1p1').value, 'Jack');
  assert.equal(a.inserted.length, 0);
});

test('CSV round-trip keeps both formats and timestamps regardless of selected mode', async () => {
  const a = await app();
  a.mode(3);
  const rows = a.json('parseMatchCSV(toCSV())');
  assert.equal(rows.length, 4);
  assert.equal(rows[0].t1p3, null);
  assert.equal(rows[2].t1p3, 'Jack');
  assert.equal(rows[2].t2p3, 'Tommy');
  assert.equal(rows[2].created_at, fixtures[2].created_at);
});

test('both legacy CSV formats import as 2v2, including empty timestamps', async () => {
  const a = await app([]);
  for (const csv of [
    'game,team1p1,team1p2,team2p1,team2p2,result\n1,Jack,Jake,George,Matt,win',
    'game,created_at,team1p1,team1p2,team2p1,team2p2,result\r\n1,,Jack,Jake,George,Matt,win'
  ]) {
    const rows = a.json(`parseMatchCSV(${JSON.stringify(csv)})`);
    assert.equal(rows[0].t1p3, null);
    assert.equal(rows[0].t2p1, 'George');
    assert.equal(rows[0].result, 'win');
  }
});

test('mixed-format import writes nullable third fields consistently', async () => {
  const a = await app();
  a.element('csv-import').value = a.run('toCSV()');
  await a.run('importCSV()');
  assert.equal(a.deleted.length, 1);
  assert.equal(a.inserted.length, 4);
  assert.equal(a.inserted[0].t1p3, null);
  assert.equal(a.inserted[3].t2p3, 'Tommy');
});

test('invalid CSV never deletes existing matches', async () => {
  const a = await app();
  const header = 'game,team1p1,team1p2,team1p3,team2p1,team2p2,team2p3,result\n';
  for (const row of [
    '1,Jack,Jake,Jeremy,George,Matt,,win',
    '1,Jack,Jake,Jeremy,George,Matt,Jack,win',
    '1,Jack,Jake,,George,Matt,,loss',
    'invalid,Jack,Jake,,George,Matt,,win',
    '1,Jack,Jake,,George,Matt,win'
  ]) {
    a.element('csv-import').value = header + row;
    await a.run('importCSV()');
  }
  assert.equal(a.alerts.length, 5);
  assert.equal(a.deleted.length, 0);
  assert.equal(a.saved.length, fixtures.length);
});

test('CSV parser preserves quoted commas, quotes and empty fields', async () => {
  const a = await app([]);
  assert.deepEqual(a.json('parseCSV(\'a,"b,c","d""e",,f\\r\\n\')'), [['a', 'b,c', 'd"e', '', 'f']]);
});

test('legacy matches sharing a game number survive export and import', async () => {
  // The existing database contains two matches numbered 121.
  const a = await app([{ ...fixtures[0], game: 121 }, { ...fixtures[1], game: 121 }]);
  const rows = a.json('parseMatchCSV(toCSV())');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].game, 121);
  assert.equal(rows[1].game, 121);
  assert.equal(rows[0].result, 'win');
  assert.equal(rows[1].result, 'tie');
});
