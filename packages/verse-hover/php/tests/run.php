<?php
/**
 * Plain PHP test runner (no PHPUnit).
 *   php php/tests/run.php            runs with the default driver (or VH_DRIVER from the environment)
 *   php php/tests/run.php --both     runs once per available driver (pdo, sqlite3)
 * Exit status 0 = all passed.
 */
if (in_array('--both', $argv, true)) {
    $drivers = array();
    if (extension_loaded('pdo_sqlite')) {
        $drivers[] = 'pdo';
    }
    if (class_exists('SQLite3')) {
        $drivers[] = 'sqlite3';
    }
    $rc = 0;
    foreach ($drivers as $d) {
        echo "=== driver: $d ===\n";
        passthru('VH_DRIVER=' . $d . ' ' . escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__), $code);
        $rc = $rc ?: $code;
    }
    exit($rc);
}

define('VH_NO_RUN', 1);
require __DIR__ . '/../verse-hover.php';

$FIX = realpath(__DIR__ . '/../../test/fixtures');
$MINI = $FIX . '/mini.db';
$NC = $FIX . '/mini-nc.db';
$SCRIPT = realpath(__DIR__ . '/../verse-hover.php');

$pass = 0;
$fail = 0;
function check($cond, $name, $detail = '')
{
    global $pass, $fail;
    if ($cond) {
        $pass++;
    } else {
        $fail++;
        echo "FAIL: $name" . ($detail !== '' ? "\n      $detail" : '') . "\n";
    }
}
function eq($a, $b, $name)
{
    check($a === $b, $name, 'expected ' . var_export($b, true) . ' got ' . var_export($a, true));
}

function tmpdir()
{
    $d = sys_get_temp_dir() . '/vh-test-' . bin2hex(random_bytes(4));
    mkdir($d, 0777, true);
    return $d;
}
function rrmdir($d)
{
    if (!is_dir($d)) {
        return;
    }
    foreach (scandir($d) as $f) {
        if ($f === '.' || $f === '..') {
            continue;
        }
        is_dir("$d/$f") && !is_link("$d/$f") ? rrmdir("$d/$f") : unlink("$d/$f");
    }
    rmdir($d);
}
function run_cli(array $args, &$out, &$err)
{
    $cmd = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($GLOBALS['SCRIPT']);
    foreach ($args as $a) {
        $cmd .= ' ' . escapeshellarg($a);
    }
    $p = proc_open($cmd, array(1 => array('pipe', 'w'), 2 => array('pipe', 'w')), $pipes);
    $out = stream_get_contents($pipes[1]);
    $err = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    return proc_close($p);
}
function call($q, $cfgExtra = array(), $method = 'GET', $req = array())
{
    $cfg = array_merge(array('translations' => array('KJV' => $GLOBALS['MINI'], 'NCTEST' => $GLOBALS['NC']), 'allowed_origins' => array(), 'cache_ttl' => 86400), $cfgExtra);
    parse_str($q, $get);
    return vh_handle($cfg, $method, $get, $req);
}
function jbody($res)
{
    return json_decode($res['body'], true);
}

echo 'driver: ' . (getenv('VH_DRIVER') ?: '(auto)') . ' / php ' . PHP_VERSION . "\n";

// --- driver sanity
$d = vh_open($MINI);
check(in_array($d->driver, array('pdo', 'sqlite3'), true), 'driver opened');
if (getenv('VH_DRIVER')) {
    eq($d->driver, strtolower(getenv('VH_DRIVER')), 'VH_DRIVER forces the driver');
}
$threw = false;
try {
    $d->exec("CREATE TABLE zz (a)");
} catch (Throwable $e) {
    $threw = true;
}
check($threw, 'database opened read-only (write refused)');
$d->close();

// --- list / basic
$r = call('list=1');
eq($r['status'], 200, 'list status');
eq(jbody($r), array(
    array('abbr' => 'KJV', 'name' => 'King James Version (1769) with Strongs Numbers and Morphology  and CatchWords', 'lang' => 'en'),
    array('abbr' => 'NCTEST', 'name' => 'Non-commercial test module', 'lang' => 'en'),
), 'list body');
eq($r['headers']['Content-Type'], 'application/json; charset=utf-8', 'content-type');
eq($r['headers']['Cache-Control'], 'public, max-age=86400', 'cache-control');
eq($r['headers']['X-Content-Type-Options'], 'nosniff', 'nosniff');
eq($r['headers']['Access-Control-Allow-Origin'], '*', 'CORS default *');
check(isset($r['headers']['ETag']), 'etag present');

// --- validation
eq(call('r=43003016')['status'], 400, 'missing t');
eq(call('t=K%24V&r=43003016')['status'], 400, 'bad t chars');
eq(call('t=ABCDEFGHIJKLMNOPQ&r=43003016')['status'], 400, 't too long');
$r = call('t=NOPE&r=43003016');
eq($r['status'], 404, 'unknown translation 404');
eq(jbody($r), array('error' => 'unknown translation'), 'unknown translation body');
eq(call('t=KJV')['status'], 400, 'no r/k/m');
eq(call('t=KJV&r=43003016&k=43003')['status'], 400, 'r and k together');
eq(call('t=KJV&r=abc')['status'], 400, 'r letters');
eq(call('t=KJV&r=430030')['status'], 400, 'r 6 digits');
eq(call('t=KJV&r=430030161')['status'], 400, 'r 9 digits');
eq(call('t=KJV&r=43003016-')['status'], 400, 'r dangling dash');
eq(call('t=KJV&r=67001001')['status'], 400, 'r book 67');
eq(call('t=KJV&r=43000001')['status'], 400, 'r chapter 0');
eq(call('t=KJV&r=43003018-43003014')['status'], 400, 'r reversed');
eq(call('t=KJV&r[]=43003016')['status'], 400, 'array param');
eq(call('t=KJV&k=300')['status'], 400, 'k 3 digits');
eq(call('t=KJV&k=67001')['status'], 400, 'k book 67');
eq(call('t=KJV&k=43000')['status'], 400, 'k chapter 0');
eq(call('t=KJV&k=43999')['status'], 404, 'k missing chapter 404');
eq(call('t=KJV&m=2')['status'], 400, 'm invalid');
$many = implode(',', array_fill(0, 51, '43003016'));
eq(call('t=KJV&r=' . $many)['status'], 413, '51 ranges -> 413');
eq(call('t=KJV&r=' . implode(',', array_fill(0, 50, '43003016')))['status'], 200, '50 ranges ok');
$big = implode(',', array_fill(0, 10, '1001001-66022021'));
$r = call('t=KJV&r=' . $big);
eq($r['status'], 413, '>500 verses -> 413');
eq(jbody($r), array('error' => 'too many verses'), '413 body');
eq(call('t=KJV&r=43003016', array(), 'POST')['status'], 405, 'POST 405');
eq(call('t=KJV&r=43003016', array(), 'HEAD')['status'], 405, 'HEAD 405');
eq(call('t=KJV&r=43003016', array(), 'DELETE')['headers']['Allow'], 'GET, OPTIONS', 'Allow header on 405');
check(strpos(call('t=NOPE&r=1')['headers']['Cache-Control'], 'no-store') !== false, 'errors not cached');

// --- ranges, clipping, segments
$r = call('t=KJV&r=43003014-43003018,45005008');
eq($r['status'], 200, 'range status');
$b = jbody($r);
eq($b['t'], 'KJV', 'range t');
eq(count($b['s']), 2, 'Romans absent from mini -> John slice plus an empty slice for Romans');
eq(count($b['s'][1]['v']), 0, 'the missing range gets an empty slice, keeping request order');
eq($b['s'][0]['k'], 43003, 'k');
eq($b['s'][0]['f'], 14, 'f = first returned verse');
eq(count($b['s'][0]['v']), 5, 'five verses');
eq($b['s'][0]['n'], 36, 'n = verses in chapter');
eq(array_keys($b['s'][0]), array('k', 'f', 'v', 'n', 'p'), 'key order k,f,v,n,p');
eq($b['s'][0]['p'], array(14, 16, 18), 'paragraph starts in 14-18 include 16 (John 3:16)');

$r = call('t=KJV&r=43003035-43004001');
$b = jbody($r);
eq(count($b['s']), 2, 'chapter-crossing range split into 2 slices');
eq($b['s'][0]['k'], 43003, 'slice 1 chapter');
eq($b['s'][0]['f'], 35, 'slice 1 f');
eq(count($b['s'][0]['v']), 2, 'slice 1 has verses 35,36');
eq($b['s'][1]['k'], 43004, 'slice 2 chapter');
eq($b['s'][1]['f'], 1, 'slice 2 f');
eq(count($b['s'][1]['v']), 1, 'slice 2 has verse 1');

$r = call('t=KJV&r=43003003');
$v = jbody($r)['s'][0]['v'][0];
eq($v[0], 'Jesus answered and said unto him,', 'John 3:3 plain lead');
eq($v[1][0], 'w', 'John 3:3 words of Christ');
check(strpos($v[1][1], ' Verily, verily') === 0, 'John 3:3 segment carries leading space');

$r = call('t=KJV&r=19023001');
$s = jbody($r)['s'][0];
eq($s['v'][0][0], 'The', 'Ps 23:1 seg 0');
eq($s['v'][0][1], array('d', ' Lord'), 'Ps 23:1 divine name');
eq($s['v'][0][2], array('s', ' is'), 'Ps 23:1 supplied');
eq($s['h'], array('1' => 'A Psalm of David.'), 'Ps 23:1 heading');
check(strpos($r['body'], '"h":{"1":"A Psalm of David."}') !== false, 'h encodes as object');

$r = call('t=KJV&r=1001001');
eq(jbody($r)['s'][0]['v'][0], 'In the beginning God created the heaven and the earth.', 'Gen 1:1 plain string unchanged');
$r = call('t=KJV&r=43003016');
check(strpos($r['body'], '\\u') === false, 'no \\u escapes (UNESCAPED_UNICODE)');
eq(jbody(call('t=KJV&r=40005001-40005012'))['s'][0]['n'], 12, 'Matt 5 n');
eq(count(jbody(call('t=KJV&r=31001001-31001021'))['s'][0]['v']), 21, 'Obadiah 21 verses');
eq(count(jbody(call('t=KJV&r=64001001-64001014'))['s'][0]['v']), 14, '3 John 14 verses');
eq(jbody(call('t=KJV&r=1002001'))['s'], array(array('k' => 1002, 'f' => 1, 'v' => array(), 'n' => 0)), 'range with no rows -> one empty slice');

// --- chapter, manifest vs static
$tmp = tmpdir();
$out = '';
$err = '';
$rc = run_cli(array('build-static', '--db=' . $MINI, '--out=' . $tmp, '--gzip'), $out, $err);
eq($rc, 0, 'build-static exit 0');
check(is_file("$tmp/KJV/43/3.json"), 'static 43/3.json exists');
check(is_file("$tmp/KJV/43/3.json.gz"), 'static 43/3.json.gz exists');
check(is_file("$tmp/KJV/manifest.json") && is_file("$tmp/index.json"), 'manifest and index exist');
foreach (array('43003', '19023', '1001', '31001', '64001', '40005', '43004') as $k) {
    $b = intdiv((int)$k, 1000);
    $c = (int)$k % 1000;
    $r = call('t=KJV&k=' . $k);
    eq($r['body'], file_get_contents("$tmp/KJV/$b/$c.json"), "dynamic k=$k identical to static");
    $gz = file_get_contents("$tmp/KJV/$b/$c.json.gz");
    eq(gzdecode($gz), $r['body'], "gz k=$k decompresses to same");
}
eq(call('t=KJV&m=1')['body'], file_get_contents("$tmp/KJV/manifest.json"), 'dynamic manifest identical to static');
run_cli(array('build-static', '--db=' . $NC, '--out=' . $tmp, '--force-license'), $out, $err);
eq(call('list=1')['body'], file_get_contents("$tmp/index.json"), 'dynamic list identical to static index.json');
$man = json_decode(file_get_contents("$tmp/KJV/manifest.json"), true);
eq(array_keys($man), array('abbr', 'name', 'lang', 'dir', 'copyright', 'license', 'versification', 'sha', 'counts'), 'manifest key order');
eq(count($man['counts']), 66, 'manifest 66 books');
eq($man['counts'][42], array(0, 0, 36, 3), 'John counts (ch3=36, ch4=3 in fixture)');
eq($man['counts'][18][22], 6, 'Psalm 23 has 6 verses');
eq($man['counts'][3], array(), 'empty book -> []');
eq($man['license'], 'GPL-2.0-or-later', 'manifest license');
check(strpos(file_get_contents("$tmp/KJV/manifest.json"), '"counts":[[') !== false, 'manifest compact');
check(substr(file_get_contents("$tmp/KJV/43/3.json"), -1) !== "\n", 'no trailing newline');
rrmdir($tmp);

// --- CLI build-static variants
$tmp = tmpdir();
$rc = run_cli(array('build-static', '--db=' . $MINI, '--out=' . $tmp, '--gzip', '--no-plain'), $out, $err);
eq($rc, 0, 'gzip-only build exit 0');
check(!is_file("$tmp/KJV/43/3.json") && is_file("$tmp/KJV/43/3.json.gz"), '--no-plain leaves only .gz');
rrmdir($tmp);
$tmp = tmpdir();
$rc = run_cli(array('build-static', '--db=' . $MINI, '--out=' . $tmp, '--no-plain'), $out, $err);
eq($rc, 1, '--no-plain without --gzip refused');
rrmdir($tmp);
$tmp = tmpdir();
$rc = run_cli(array('build-static', '--db=' . $MINI, '--out=' . $tmp, '--no-formatting'), $out, $err);
eq($rc, 0, '--no-formatting exit 0');
$ch = json_decode(file_get_contents("$tmp/KJV/43/3.json"), true);
check(is_string($ch['v'][2]), '--no-formatting: John 3:3 is a plain string');
check(!isset($ch['p']), '--no-formatting: p omitted');
eq($ch['v'][15], 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.', 'John 3:16 literal KJV text');
$ps = json_decode(file_get_contents("$tmp/KJV/19/23.json"), true);
eq($ps['h'], array('1' => 'A Psalm of David.'), '--no-formatting keeps headings');
rrmdir($tmp);
// index merge
$tmp = tmpdir();
run_cli(array('build-static', '--db=' . $MINI, '--out=' . $tmp), $out, $err);
run_cli(array('build-static', '--db=' . $NC, '--out=' . $tmp, '--force-license'), $out, $err);
eq(array_column(json_decode(file_get_contents("$tmp/index.json"), true), 'abbr'), array('KJV', 'NCTEST'), 'index.json merged and sorted');
run_cli(array('build-static', '--db=' . $MINI, '--out=' . $tmp), $out, $err);
eq(count(json_decode(file_get_contents("$tmp/index.json"), true)), 2, 'rebuilding does not duplicate index entry');
rrmdir($tmp);

// --- license guard
foreach (array('GPL-2.0-or-later', 'Public Domain', 'public-domain', 'CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'MIT', 'Apache-2.0', 'LGPL-3.0', 'Unlicense', 'CC-BY-3.0', 'PD') as $ok) {
    check(vh_license_allowed($ok), "license allowed: $ok");
}
foreach (array('CC-BY-NC-4.0', 'cc-by-nc-sa-3.0', 'CC-BY-NC-ND-4.0', '', null, '  ', 'proprietary', 'Limited permitted use', 'All rights reserved') as $bad) {
    check(!vh_license_allowed($bad), 'license refused: ' . var_export($bad, true));
}
$tmp = tmpdir();
$rc = run_cli(array('build-static', '--db=' . $NC, '--out=' . $tmp), $out, $err);
eq($rc, 2, 'NC license refused with exit 2');
check(strpos($err, 'Refusing') !== false, 'refusal message on stderr');
check(!is_dir("$tmp/NCTEST"), 'nothing written when refused');
$rc = run_cli(array('build-static', '--db=' . $NC, '--out=' . $tmp, '--force-license'), $out, $err);
eq($rc, 0, '--force-license overrides');
check(is_file("$tmp/NCTEST/43/3.json"), 'forced build wrote output');
rrmdir($tmp);

// --- CLI info / usage / slim
$rc = run_cli(array('info', '--db=' . $MINI), $out, $err);
eq($rc, 0, 'info exit 0');
check(strpos($out, "abbreviation: KJV\n") !== false && strpos($out, 'license: GPL-2.0-or-later') !== false && strpos($out, 'verses: 97') !== false, 'info output', $out);
eq(run_cli(array(), $out, $err), 1, 'no command -> usage exit 1');
eq(run_cli(array('nope', '--db=x'), $out, $err), 1, 'unknown command exit 1');
eq(run_cli(array('info', '--db=/nonexistent.db'), $out, $err), 1, 'missing db exit 1');
$tmp = tmpdir();
$rc = run_cli(array('slim', '--db=' . $MINI, '--out=' . $tmp . '/slim.db'), $out, $err);
eq($rc, 0, 'slim exit 0');
$sl = vh_open($tmp . '/slim.db');
eq((int)$sl->all('SELECT COUNT(*) AS n FROM bible_verse')[0]['n'], 97, 'slim verse count');
eq($sl->all('SELECT abbreviation FROM module_info')[0]['abbreviation'], 'KJV', 'slim module_info');
$sl->close();
$cfg = array('translations' => array('KJV' => $tmp . '/slim.db'));
parse_str('t=KJV&k=43003', $g);
eq(vh_handle($cfg, 'GET', $g, array())['body'], call('t=KJV&k=43003')['body'], 'slim serves identical chapter');
eq(run_cli(array('slim', '--db=' . $MINI, '--out=' . $tmp . '/slim.db'), $out, $err), 1, 'slim refuses to overwrite');
$rc = run_cli(array('slim', '--db=' . $MINI, '--out=' . $tmp . '/slim2.db', '--no-formatting'), $out, $err);
parse_str('t=KJV&k=43003', $g);
$ch = json_decode(vh_handle(array('translations' => array('KJV' => $tmp . '/slim2.db')), 'GET', $g, array())['body'], true);
check(is_string($ch['v'][2]), 'slim --no-formatting drops spans');
rrmdir($tmp);

// --- ETag / 304
$r = call('t=KJV&r=43003016');
$etag = $r['headers']['ETag'];
check(preg_match('/^"[0-9a-f]{32}"$/', $etag) === 1, 'etag format');
$r2 = call('t=KJV&r=43003016', array(), 'GET', array('if-none-match' => $etag));
eq($r2['status'], 304, 'If-None-Match -> 304');
eq($r2['body'], '', '304 has no body');
eq($r2['headers']['ETag'], $etag, '304 carries etag');
eq(call('t=KJV&r=43003016', array(), 'GET', array('if-none-match' => 'W/' . $etag))['status'], 304, 'weak etag matches');
eq(call('t=KJV&r=43003016', array(), 'GET', array('if-none-match' => '"x", ' . $etag))['status'], 304, 'etag list matches');
eq(call('t=KJV&r=43003016', array(), 'GET', array('if-none-match' => '"stale"'))['status'], 200, 'stale etag -> 200');
check(call('t=KJV&r=43003017')['headers']['ETag'] !== $etag, 'different query -> different etag');
eq(call('r=43003016&t=KJV')['headers']['ETag'], $etag, 'param order does not change etag');

// --- CORS
$cfgO = array('allowed_origins' => array('https://a.example', 'https://b.example'));
$r = call('t=KJV&r=43003016', $cfgO, 'GET', array('origin' => 'https://b.example'));
eq($r['headers']['Access-Control-Allow-Origin'], 'https://b.example', 'allowed origin echoed');
eq($r['headers']['Vary'], 'Accept-Encoding, Origin', 'Vary includes Origin');
$r = call('t=KJV&r=43003016', $cfgO, 'GET', array('origin' => 'https://evil.example'));
check(!isset($r['headers']['Access-Control-Allow-Origin']), 'disallowed origin gets no ACAO');
$r = call('t=KJV&r=43003016', array(), 'OPTIONS');
eq($r['status'], 204, 'OPTIONS 204');
eq($r['body'], '', 'OPTIONS no body');
eq($r['headers']['Access-Control-Allow-Origin'], '*', 'OPTIONS CORS');
check(strpos($r['headers']['Access-Control-Allow-Methods'], 'GET') !== false, 'OPTIONS allow methods');
check(isset(call('t=NOPE&r=1')['headers']['Access-Control-Allow-Origin']), 'errors carry CORS');

// --- HTTP smoke via php -S, with auto-discovery
function http_get($url, $headers = array())
{
    $ctx = stream_context_create(array('http' => array('ignore_errors' => true, 'header' => implode("\r\n", $headers), 'timeout' => 10)));
    $body = @file_get_contents($url, false, $ctx);
    $status = 0;
    $hdr = array();
    foreach (isset($http_response_header) ? $http_response_header : array() as $h) {
        if (preg_match('#^HTTP/\S+ (\d+)#', $h, $m)) {
            $status = (int)$m[1];
        } elseif (strpos($h, ':') !== false) {
            list($n, $v) = explode(':', $h, 2);
            $hdr[strtolower($n)] = trim($v);
        }
    }
    return array($status, $hdr, $body);
}
$srv = tmpdir();
copy($SCRIPT, "$srv/verse-hover.php");
copy($MINI, "$srv/bible_kjv.db");
$port = 0;
for ($i = 0; $i < 20 && !$port; $i++) {
    $p = random_int(20000, 60000);
    $s = @stream_socket_server("tcp://127.0.0.1:$p");
    if ($s) {
        fclose($s);
        $port = $p;
    }
}
$proc = proc_open(
    escapeshellarg(PHP_BINARY) . ' -d display_errors=1 -d error_reporting=-1 -S 127.0.0.1:' . $port . ' -t ' . escapeshellarg($srv),
    array(0 => array('file', '/dev/null', 'r'), 1 => array('file', "$srv/server.log", 'w'), 2 => array('file', "$srv/server.log", 'a')),
    $pipes,
    null,
    array_merge(getenv(), array('VH_DRIVER' => (string)getenv('VH_DRIVER')))
);
$up = false;
for ($i = 0; $i < 50; $i++) {
    $c = @fsockopen('127.0.0.1', $port);
    if ($c) {
        fclose($c);
        $up = true;
        break;
    }
    usleep(100000);
}
check($up, 'php -S started');
if ($up) {
    $base = "http://127.0.0.1:$port/verse-hover.php";
    list($st, $h, $body) = http_get($base . '?list=1');
    eq($st, 200, 'http list status');
    eq(json_decode($body, true), array(array('abbr' => 'KJV', 'name' => 'King James Version (1769) with Strongs Numbers and Morphology  and CatchWords', 'lang' => 'en')), 'http discovery finds KJV');
    check(is_file("$srv/verse-hover.cache.php"), 'discovery cache written');
    list($st, $h, $body) = http_get($base . '?t=KJV&k=43003');
    eq($st, 200, 'http chapter status');
    eq($body, call('t=KJV&k=43003')['body'], 'http chapter bytes == in-process bytes');
    eq($h['content-type'], 'application/json; charset=utf-8', 'http content-type');
    eq($h['access-control-allow-origin'], '*', 'http CORS');
    eq($h['x-content-type-options'], 'nosniff', 'http nosniff');
    list($st, $h2, $b2) = http_get($base . '?t=KJV&k=43003', array('If-None-Match: ' . $h['etag']));
    eq($st, 304, 'http 304');
    eq($b2, '', 'http 304 empty');
    list($st, $h3, $gz) = http_get($base . '?t=KJV&k=43003', array('Accept-Encoding: gzip'));
    eq($st, 200, 'http gzip status');
    if (function_exists('ob_gzhandler')) {
        eq(isset($h3['content-encoding']) ? $h3['content-encoding'] : '', 'gzip', 'http gzip content-encoding');
        eq(gzdecode($gz), $body, 'http gzip body decompresses to same');
    }
    list($st, , $b) = http_get($base . '?t=KJV&r=43003035-43004001');
    eq(count(json_decode($b, true)['s']), 2, 'http clipping');
    list($st, , $b) = http_get($base . '?t=NOPE&r=43003016');
    eq($st, 404, 'http 404');
    list($st, , $b) = http_get($base . '?t=KJV&r=zzz');
    eq($st, 400, 'http 400');
    eq(json_decode($b, true), array('error' => 'invalid r'), 'http 400 JSON, no notices');
    // CLI commands are unreachable over HTTP
    list($st, , $b) = http_get($base . '?build-static&db=bible_kjv.db&out=/tmp/x&slim=1');
    eq($st, 400, 'CLI args over HTTP are just a bad request');
    check(!is_dir('/tmp/x/KJV'), 'no build over HTTP');
    // POST
    $ctx = stream_context_create(array('http' => array('method' => 'POST', 'content' => 'x=1', 'ignore_errors' => true)));
    @file_get_contents($base . '?t=KJV&k=43003', false, $ctx);
    check(strpos($http_response_header[0], '405') !== false, 'http POST 405');
    $log = file_get_contents("$srv/server.log");
    check(!preg_match('/(Warning|Notice|Deprecated|Fatal error)/', $log), 'server log has no PHP warnings', $log);
}
proc_terminate($proc);
proc_close($proc);
rrmdir($srv);

echo "\n$pass passed, $fail failed\n";
exit($fail ? 1 : 0);
