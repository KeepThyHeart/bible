<?php
/**
 * verse-hover.php - single-file, dependency-free Bible verse API + static-data generator.
 *
 * HTTP (GET only):
 *   ?t=KJV&r=43003014-43003018,45005008   verse ranges  -> {"t":"KJV","s":[ChapterSlice,...]}
 *   ?t=KJV&k=43003                        whole chapter  -> ChapterSlice (same bytes as static 43/3.json)
 *   ?t=KJV&m=1                            manifest       (same bytes as static manifest.json)
 *   ?list=1                               translation index
 *
 * CLI (only when run from the command line, never reachable over HTTP):
 *   php verse-hover.php build-static --db=bible_kjv.db --out=bible-data [--gzip] [--no-plain] [--no-formatting] [--force-license]
 *   php verse-hover.php slim --db=bible_kjv.db --out=slim.db [--no-formatting]
 *   php verse-hover.php info --db=bible_kjv.db
 *
 * PHP 7.4+. Uses PDO sqlite or the SQLite3 class (whichever exists; VH_DRIVER=pdo|sqlite3 forces one).
 * Configuration: optional verse-hover.config.php next to this file (or the file named by env VH_CONFIG).
 * Verse text is copied from the database unchanged; the database is always opened read-only.
 */

// ---------------------------------------------------------------------------
// Built-in configuration (override with verse-hover.config.php)
// ---------------------------------------------------------------------------
function vh_builtin_config()
{
    return array(
        // 'KJV' => '/path/to/bible_kjv.db'. null = auto-discover *.db files next to this file.
        'translations' => null,
        // Empty = "Access-Control-Allow-Origin: *". Otherwise only these origins are echoed back.
        'allowed_origins' => array(),
        // Cache-Control max-age in seconds.
        'cache_ttl' => 86400,
    );
}

// ---------------------------------------------------------------------------
// Database access (driver-agnostic)
// ---------------------------------------------------------------------------
final class VhDb
{
    private $allFn;
    private $execFn;
    private $closeFn;
    public $driver;

    public function __construct($driver, $allFn, $execFn, $closeFn)
    {
        $this->driver = $driver;
        $this->allFn = $allFn;
        $this->execFn = $execFn;
        $this->closeFn = $closeFn;
    }

    /** @return array[] list of associative rows */
    public function all($sql, array $params = array())
    {
        $f = $this->allFn;
        return $f($sql, $params);
    }

    public function exec($sql, array $params = array())
    {
        $f = $this->execFn;
        $f($sql, $params);
    }

    public function close()
    {
        $f = $this->closeFn;
        $f();
    }
}

function vh_pdo_available()
{
    return extension_loaded('pdo_sqlite') && class_exists('PDO') && in_array('sqlite', PDO::getAvailableDrivers(), true);
}

function vh_sqlite3_available()
{
    return class_exists('SQLite3');
}

function vh_open($path, $writable = false)
{
    $want = strtolower((string)getenv('VH_DRIVER'));
    if ($want === 'pdo') {
        if (!vh_pdo_available()) {
            throw new RuntimeException('VH_DRIVER=pdo but pdo_sqlite is not available');
        }
        return vh_open_pdo($path, $writable);
    }
    if ($want === 'sqlite3') {
        if (!vh_sqlite3_available()) {
            throw new RuntimeException('VH_DRIVER=sqlite3 but the SQLite3 class is not available');
        }
        return vh_open_sqlite3($path, $writable);
    }
    if (vh_pdo_available()) {
        return vh_open_pdo($path, $writable);
    }
    if (vh_sqlite3_available()) {
        return vh_open_sqlite3($path, $writable);
    }
    throw new RuntimeException('Neither pdo_sqlite nor SQLite3 is available');
}

function vh_open_pdo($path, $writable)
{
    $opts = array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION);
    if (!$writable) {
        // PHP 8.4+: Pdo\Sqlite::ATTR_OPEN_FLAGS (the PDO::SQLITE_* names are deprecated in 8.5).
        if (defined('Pdo\\Sqlite::ATTR_OPEN_FLAGS') && defined('Pdo\\Sqlite::OPEN_READONLY')) {
            $opts[constant('Pdo\\Sqlite::ATTR_OPEN_FLAGS')] = constant('Pdo\\Sqlite::OPEN_READONLY');
        } elseif (defined('PDO::SQLITE_ATTR_OPEN_FLAGS') && defined('PDO::SQLITE_OPEN_READONLY')) {
            $opts[constant('PDO::SQLITE_ATTR_OPEN_FLAGS')] = constant('PDO::SQLITE_OPEN_READONLY');
        }
    }
    if (!$writable && !is_file($path)) {
        throw new RuntimeException('Database not found: ' . $path);
    }
    $pdo = new PDO('sqlite:' . $path, null, null, $opts);
    if (!$writable) {
        $pdo->exec('PRAGMA query_only = 1');
    }
    $all = function ($sql, $params) use ($pdo) {
        $st = $pdo->prepare($sql);
        $i = 1;
        foreach ($params as $v) {
            $st->bindValue($i++, $v, is_int($v) ? PDO::PARAM_INT : PDO::PARAM_STR);
        }
        $st->execute();
        $rows = $st->fetchAll(PDO::FETCH_ASSOC);
        $st->closeCursor();
        return $rows;
    };
    $exec = function ($sql, $params) use ($pdo) {
        $st = $pdo->prepare($sql);
        $i = 1;
        foreach ($params as $v) {
            $st->bindValue($i++, $v, $v === null ? PDO::PARAM_NULL : (is_int($v) ? PDO::PARAM_INT : PDO::PARAM_STR));
        }
        $st->execute();
        $st->closeCursor();
    };
    $close = function () use (&$pdo) {
        $pdo = null;
    };
    return new VhDb('pdo', $all, $exec, $close);
}

function vh_open_sqlite3($path, $writable)
{
    if (!$writable && !is_file($path)) {
        throw new RuntimeException('Database not found: ' . $path);
    }
    $flags = $writable ? (SQLITE3_OPEN_READWRITE | SQLITE3_OPEN_CREATE) : SQLITE3_OPEN_READONLY;
    $db = new SQLite3($path, $flags);
    $db->enableExceptions(true);
    $bind = function ($st, $params) {
        $i = 1;
        foreach ($params as $v) {
            $st->bindValue($i++, $v, $v === null ? SQLITE3_NULL : (is_int($v) ? SQLITE3_INTEGER : SQLITE3_TEXT));
        }
    };
    $all = function ($sql, $params) use ($db, $bind) {
        $st = $db->prepare($sql);
        $bind($st, $params);
        $res = $st->execute();
        $rows = array();
        while (($r = $res->fetchArray(SQLITE3_ASSOC)) !== false) {
            $rows[] = $r;
        }
        $res->finalize();
        $st->close();
        return $rows;
    };
    $exec = function ($sql, $params) use ($db, $bind) {
        if (!$params) {
            $db->exec($sql);
            return;
        }
        $st = $db->prepare($sql);
        $bind($st, $params);
        $st->execute();
        $st->close();
    };
    $close = function () use ($db) {
        $db->close();
    };
    return new VhDb('sqlite3', $all, $exec, $close);
}

// ---------------------------------------------------------------------------
// Data format
// ---------------------------------------------------------------------------
function vh_json($v)
{
    $flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;
    if (defined('JSON_UNESCAPED_LINE_TERMINATORS')) {
        $flags |= JSON_UNESCAPED_LINE_TERMINATORS;
    }
    $s = json_encode($v, $flags);
    if ($s === false) {
        throw new RuntimeException('JSON encoding failed: ' . json_last_error_msg());
    }
    return $s;
}

/** Same whitespace class as the Node twin (JS \s). */
function vh_split_words($text)
{
    $w = preg_split('/[\t\n\x0B\f\r \x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]+/u', $text, -1, PREG_SPLIT_NO_EMPTY);
    return $w === false ? null : $w;
}

/**
 * @return array [value (string|array), heading (string|null), paragraphStart (bool)]
 */
function vh_verse($text, $formatting, $withFormatting)
{
    $heading = null;
    $para = false;
    $spans = array();
    if (is_string($formatting) && $formatting !== '') {
        $fd = json_decode($formatting, true);
        if (is_array($fd)) {
            if (isset($fd['block']) && is_array($fd['block'])) {
                if (isset($fd['block']['heading']) && is_string($fd['block']['heading']) && $fd['block']['heading'] !== '') {
                    $heading = $fd['block']['heading'];
                }
                if (isset($fd['block']['paragraph_start']) && $fd['block']['paragraph_start'] === true) {
                    $para = true;
                }
            }
            if (isset($fd['spans']) && is_array($fd['spans'])) {
                $spans = $fd['spans'];
            }
        }
    }
    if (!$withFormatting || !$spans) {
        return array($text, $heading, $para);
    }
    $w = vh_split_words($text);
    if ($w === null) {
        return array($text, $heading, $para);
    }
    $n = count($w);
    $cls = array_fill(0, $n, '');
    foreach ($spans as $s) {
        if (!is_array($s) || !isset($s['type']) || !is_string($s['type']) || $s['type'] === ''
            || !isset($s['start'], $s['end']) || !is_int($s['start']) || !is_int($s['end'])) {
            continue;
        }
        $c = $s['type'][0];
        for ($i = max($s['start'], 0); $i <= $s['end'] && $i < $n; $i++) {
            $cls[$i] .= $c;
        }
    }
    $segs = array();
    $cur = null;
    for ($i = 0; $i < $n; $i++) {
        $t = ($i ? ' ' : '') . $w[$i];
        if ($cls[$i] !== '') {
            if ($cur !== null && $segs[$cur][0] === $cls[$i]) {
                $segs[$cur][1] .= $t;
            } else {
                $segs[] = array($cls[$i], $t);
                $cur = count($segs) - 1;
            }
        } else {
            $last = count($segs) - 1;
            if ($last >= 0 && is_string($segs[$last])) {
                $segs[$last] .= $t;
            } else {
                $segs[] = $t;
            }
            $cur = null;
        }
    }
    return array($segs, $heading, $para);
}

/**
 * Build a ChapterSlice array (key order k,f,v,n,h,p).
 * @param int $k chapter key (book*1000+chapter)
 * @param array $rows rows with verse_id,text,formatting (ascending, same chapter)
 * @param int $n verses in the whole chapter
 */
function vh_slice($k, array $rows, $n, $withFormatting)
{
    $v = array();
    $h = array();
    $p = array();
    $first = null;
    foreach ($rows as $r) {
        $num = (int)$r['verse_id'] % 1000;
        if ($first === null) {
            $first = $num;
        }
        $res = vh_verse((string)$r['text'], isset($r['formatting']) ? $r['formatting'] : null, $withFormatting);
        $v[] = $res[0];
        if ($res[1] !== null) {
            $h[$num] = $res[1];
        }
        if ($withFormatting && $res[2]) {
            $p[] = $num;
        }
    }
    $o = array('k' => (int)$k, 'f' => (int)$first, 'v' => $v, 'n' => (int)$n);
    if ($h) {
        $o['h'] = (object)$h;
    }
    if ($p) {
        $o['p'] = $p;
    }
    return $o;
}

function vh_meta(VhDb $db)
{
    $r = $db->all('SELECT abbreviation, full_name, language_code, text_direction, copyright, license_spdx, versification, content_sha256 FROM module_info LIMIT 1');
    if (!$r) {
        throw new RuntimeException('module_info is empty');
    }
    return $r[0];
}

function vh_counts(VhDb $db)
{
    $rows = $db->all('SELECT verse_id / 1000 AS k, COUNT(*) AS n FROM bible_verse GROUP BY k ORDER BY k');
    $counts = array();
    for ($b = 1; $b <= 66; $b++) {
        $counts[$b] = array();
    }
    foreach ($rows as $r) {
        $k = (int)$r['k'];
        $b = intdiv($k, 1000);
        $c = $k % 1000;
        if ($b < 1 || $b > 66 || $c < 1) {
            continue;
        }
        for ($i = count($counts[$b]); $i < $c; $i++) {
            $counts[$b][$i] = 0;
        }
        $counts[$b][$c - 1] = (int)$r['n'];
    }
    return array_values($counts);
}

function vh_manifest_array(array $m, array $counts)
{
    return array(
        'abbr' => (string)$m['abbreviation'],
        'name' => (string)$m['full_name'],
        'lang' => (string)$m['language_code'],
        'dir' => (string)$m['text_direction'],
        'copyright' => $m['copyright'] === null ? null : (string)$m['copyright'],
        'license' => $m['license_spdx'] === null ? null : (string)$m['license_spdx'],
        'versification' => (string)$m['versification'],
        'sha' => $m['content_sha256'] === null ? null : (string)$m['content_sha256'],
        'counts' => $counts,
    );
}

/** Rows of one chapter (ascending). */
function vh_chapter_rows(VhDb $db, $k)
{
    return $db->all(
        'SELECT verse_id, text, formatting FROM bible_verse WHERE verse_id BETWEEN ? AND ? ORDER BY verse_id',
        array($k * 1000, $k * 1000 + 999)
    );
}

// ---------------------------------------------------------------------------
// License guard (identical logic in scripts/build-static.mjs)
// ---------------------------------------------------------------------------
function vh_license_allowed($spdx)
{
    $s = strtolower(trim((string)$spdx));
    if ($s === '') {
        return false;
    }
    // Any "NC" (non-commercial) clause refuses, e.g. CC-BY-NC-4.0, CC-BY-NC-SA-3.0.
    if (preg_match('/(^|[^a-z0-9])nc($|[^a-z0-9])/', $s)) {
        return false;
    }
    $flat = trim(preg_replace('/[-_\s]+/', ' ', $s));
    if (strpos($flat, 'public domain') !== false) {
        return true;
    }
    $allow = array('public domain', 'pd', 'cc0', 'cc-by-4.0', 'cc-by-sa', 'gpl', 'lgpl', 'mit', 'apache', 'unlicense', 'cc-by-3.0');
    foreach ($allow as $a) {
        if (preg_match('/(^|[^a-z0-9])' . preg_quote($a, '/') . '($|[^a-z0-9])/', $s)) {
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Configuration and translation discovery
// ---------------------------------------------------------------------------
function vh_config()
{
    $cfg = vh_builtin_config();
    $file = getenv('VH_CONFIG');
    if (!$file) {
        $file = __DIR__ . '/verse-hover.config.php';
    }
    if (is_file($file)) {
        $user = include $file;
        if (is_array($user)) {
            $cfg = array_merge($cfg, $user);
        }
    }
    return $cfg;
}

/** @return array abbr => absolute db path */
function vh_translations(array $cfg)
{
    $out = array();
    if (!empty($cfg['translations']) && is_array($cfg['translations'])) {
        foreach ($cfg['translations'] as $abbr => $path) {
            $path = (string)$path;
            if ($path !== '' && $path[0] !== '/' && !preg_match('/^[A-Za-z]:[\\\\\\/]/', $path)) {
                $path = __DIR__ . '/' . $path;
            }
            $out[(string)$abbr] = $path;
        }
        return $out;
    }
    $cacheFile = __DIR__ . '/verse-hover.cache.php';
    $cache = array();
    if (is_file($cacheFile)) {
        $c = @include $cacheFile;
        if (is_array($c)) {
            $cache = $c;
        }
    }
    $fresh = array();
    $files = glob(__DIR__ . '/*.db');
    if (!$files) {
        $files = array();
    }
    sort($files);
    foreach ($files as $f) {
        $sig = @filemtime($f) . ':' . @filesize($f);
        $abbr = null;
        if (isset($cache[$f]) && is_array($cache[$f]) && isset($cache[$f][0], $cache[$f][1]) && $cache[$f][0] === $sig) {
            $abbr = $cache[$f][1];
        } else {
            try {
                $db = vh_open($f);
                $r = $db->all('SELECT abbreviation FROM module_info LIMIT 1');
                $db->close();
                $abbr = $r ? (string)$r[0]['abbreviation'] : '';
            } catch (Throwable $e) {
                $abbr = '';
            }
        }
        $fresh[$f] = array($sig, $abbr);
        if ($abbr !== '' && preg_match('/^[A-Za-z0-9_-]{1,16}$/', $abbr) && !isset($out[$abbr])) {
            $out[$abbr] = $f;
        }
    }
    if ($fresh !== $cache) {
        @file_put_contents($cacheFile, '<?php return ' . var_export($fresh, true) . ';', LOCK_EX);
    }
    return $out;
}

// ---------------------------------------------------------------------------
// HTTP handling (pure: returns [status, headers, body])
// ---------------------------------------------------------------------------
function vh_reply($status, $body, array $headers)
{
    return array('status' => $status, 'headers' => $headers, 'body' => $body);
}

function vh_error($status, $msg, array $base)
{
    $base['Cache-Control'] = 'no-store';
    return vh_reply($status, vh_json(array('error' => $msg)), $base);
}

function vh_parse_ranges($r, &$err)
{
    $ranges = array();
    foreach (explode(',', $r) as $part) {
        $ends = explode('-', $part);
        $a = (int)$ends[0];
        $b = (int)(isset($ends[1]) ? $ends[1] : $ends[0]);
        foreach (array($a, $b) as $id) {
            $book = intdiv($id, 1000000);
            $ch = intdiv($id, 1000) % 1000;
            $vs = $id % 1000;
            if ($book < 1 || $book > 66 || $ch < 1 || $vs < 1) {
                $err = 'invalid verse id';
                return null;
            }
        }
        if ($b < $a) {
            $err = 'invalid range';
            return null;
        }
        $ranges[] = array($a, $b);
    }
    return $ranges;
}

/**
 * @param array $cfg config
 * @param string $method
 * @param array $get decoded query parameters
 * @param array $req lowercase request headers (origin, if-none-match)
 */
function vh_handle(array $cfg, $method, array $get, array $req)
{
    $ttl = isset($cfg['cache_ttl']) ? max(0, (int)$cfg['cache_ttl']) : 86400;
    $base = array(
        'Content-Type' => 'application/json; charset=utf-8',
        'X-Content-Type-Options' => 'nosniff',
    );
    $allowed = isset($cfg['allowed_origins']) && is_array($cfg['allowed_origins']) ? $cfg['allowed_origins'] : array();
    if (!$allowed) {
        $base['Access-Control-Allow-Origin'] = '*';
    } else {
        $base['Vary'] = 'Origin';
        $origin = isset($req['origin']) ? $req['origin'] : '';
        if ($origin !== '' && in_array($origin, $allowed, true)) {
            $base['Access-Control-Allow-Origin'] = $origin;
        }
    }

    if ($method === 'OPTIONS') {
        $h = $base;
        unset($h['Content-Type']);
        $h['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
        $h['Access-Control-Allow-Headers'] = 'If-None-Match';
        $h['Access-Control-Max-Age'] = '86400';
        return vh_reply(204, '', $h);
    }
    if ($method !== 'GET') {
        $base['Allow'] = 'GET, OPTIONS';
        return vh_error(405, 'method not allowed', $base);
    }

    $translations = vh_translations($cfg);
    $cacheHeaders = $base;
    $cacheHeaders['Cache-Control'] = 'public, max-age=' . $ttl;
    $cacheHeaders['Vary'] = isset($base['Vary']) ? 'Accept-Encoding, Origin' : 'Accept-Encoding';

    $finish = function ($sha, $body) use ($cacheHeaders, $get, $req) {
        $canon = array();
        foreach (array('t', 'r', 'k', 'm', 'list') as $key) {
            if (isset($get[$key]) && is_string($get[$key])) {
                $canon[] = $key . '=' . $get[$key];
            }
        }
        $etag = '"' . substr(sha1($sha . '|' . implode('&', $canon)), 0, 32) . '"';
        $h = $cacheHeaders;
        $h['ETag'] = $etag;
        $inm = isset($req['if-none-match']) ? $req['if-none-match'] : '';
        if ($inm !== '') {
            foreach (explode(',', $inm) as $cand) {
                $cand = trim($cand);
                if ($cand === '*' || $cand === $etag || $cand === 'W/' . $etag) {
                    unset($h['Content-Type']);
                    return vh_reply(304, '', $h);
                }
            }
        }
        return vh_reply(200, $body, $h);
    };

    // Any parameter must be a plain string.
    foreach ($get as $v) {
        if (!is_string($v)) {
            return vh_error(400, 'invalid parameter', $base);
        }
    }

    if (isset($get['list'])) {
        if ($get['list'] !== '1') {
            return vh_error(400, 'invalid list', $base);
        }
        $index = array();
        $shas = array();
        ksort($translations, SORT_STRING);
        foreach ($translations as $abbr => $path) {
            try {
                $db = vh_open($path);
                $m = vh_meta($db);
                $db->close();
            } catch (Throwable $e) {
                continue;
            }
            $index[] = array('abbr' => (string)$m['abbreviation'], 'name' => (string)$m['full_name'], 'lang' => (string)$m['language_code']);
            $shas[] = (string)$m['content_sha256'];
        }
        return $finish(implode(',', $shas), vh_json($index));
    }

    if (!isset($get['t']) || $get['t'] === '') {
        return vh_error(400, 'missing translation', $base);
    }
    $t = $get['t'];
    if (!preg_match('/^[A-Za-z0-9_-]{1,16}$/', $t)) {
        return vh_error(400, 'invalid translation', $base);
    }
    if (!isset($translations[$t])) {
        return vh_error(404, 'unknown translation', $base);
    }
    $present = 0;
    foreach (array('r', 'k', 'm') as $key) {
        if (isset($get[$key])) {
            $present++;
        }
    }
    if ($present === 0) {
        return vh_error(400, 'missing r, k or m', $base);
    }
    if ($present > 1) {
        return vh_error(400, 'use only one of r, k, m', $base);
    }

    // Validate before touching the database.
    $ranges = null;
    $k = null;
    if (isset($get['r'])) {
        $r = $get['r'];
        if (!preg_match('/^\d{7,8}(-\d{7,8})?(,\d{7,8}(-\d{7,8})?)*$/', $r)) {
            return vh_error(400, 'invalid r', $base);
        }
        if (substr_count($r, ',') + 1 > 50) {
            return vh_error(413, 'too many ranges', $base);
        }
        $err = '';
        $ranges = vh_parse_ranges($r, $err);
        if ($ranges === null) {
            return vh_error(400, $err, $base);
        }
    } elseif (isset($get['k'])) {
        if (!preg_match('/^\d{4,5}$/', $get['k'])) {
            return vh_error(400, 'invalid k', $base);
        }
        $k = (int)$get['k'];
        if (intdiv($k, 1000) < 1 || intdiv($k, 1000) > 66 || $k % 1000 < 1) {
            return vh_error(400, 'invalid k', $base);
        }
    } elseif ($get['m'] !== '1') {
        return vh_error(400, 'invalid m', $base);
    }

    try {
        $db = vh_open($translations[$t]);
        $meta = vh_meta($db);
        $sha = $meta['content_sha256'] === null ? (string)@filemtime($translations[$t]) : (string)$meta['content_sha256'];

        if (isset($get['m'])) {
            $body = vh_json(vh_manifest_array($meta, vh_counts($db)));
        } elseif ($k !== null) {
            $rows = vh_chapter_rows($db, $k);
            if (!$rows) {
                $db->close();
                return vh_error(404, 'not found', $base);
            }
            $body = vh_json(vh_slice($k, $rows, count($rows), true));
        } else {
            $slices = array();
            $total = 0;
            $counts = array();
            foreach ($ranges as $rg) {
                $rows = $db->all(
                    'SELECT verse_id, text, formatting FROM bible_verse WHERE verse_id BETWEEN ? AND ? ORDER BY verse_id LIMIT ?',
                    array($rg[0], $rg[1], 501 - $total)
                );
                $total += count($rows);
                if ($total > 500) {
                    $db->close();
                    return vh_error(413, 'too many verses', $base);
                }
                $groups = array();
                foreach ($rows as $row) {
                    $groups[intdiv((int)$row['verse_id'], 1000)][] = $row;
                }
                if (!$groups) {
                    // Always one slice per requested range, so the client can match them up.
                    $slices[] = array('k' => intdiv($rg[0], 1000), 'f' => 1, 'v' => array(), 'n' => 0);
                }
                foreach ($groups as $ck => $grp) {
                    if (!isset($counts[$ck])) {
                        $c = $db->all('SELECT COUNT(*) AS n FROM bible_verse WHERE verse_id BETWEEN ? AND ?', array($ck * 1000, $ck * 1000 + 999));
                        $counts[$ck] = (int)$c[0]['n'];
                    }
                    $slices[] = vh_slice($ck, $grp, $counts[$ck], true);
                }
            }
            $body = vh_json(array('t' => $t, 's' => $slices));
        }
        $db->close();
    } catch (Throwable $e) {
        return vh_error(500, 'server error', $base);
    }
    return $finish($sha, $body);
}

function vh_http()
{
    @ini_set('display_errors', '0');
    try {
        $cfg = vh_config();
        $req = array();
        if (isset($_SERVER['HTTP_ORIGIN'])) {
            $req['origin'] = (string)$_SERVER['HTTP_ORIGIN'];
        }
        if (isset($_SERVER['HTTP_IF_NONE_MATCH'])) {
            $req['if-none-match'] = (string)$_SERVER['HTTP_IF_NONE_MATCH'];
        }
        $res = vh_handle($cfg, isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET', $_GET, $req);
    } catch (Throwable $e) {
        $res = vh_reply(500, '{"error":"server error"}', array('Content-Type' => 'application/json; charset=utf-8', 'X-Content-Type-Options' => 'nosniff'));
    }
    $gzip = $res['status'] === 200 && strlen($res['body']) > 256
        && isset($_SERVER['HTTP_ACCEPT_ENCODING']) && stripos($_SERVER['HTTP_ACCEPT_ENCODING'], 'gzip') !== false
        && function_exists('ob_gzhandler') && !ini_get('zlib.output_compression');
    if ($gzip) {
        ob_start('ob_gzhandler');
    }
    http_response_code($res['status']);
    foreach ($res['headers'] as $name => $value) {
        header($name . ': ' . $value);
    }
    if (!$gzip) {
        header('Content-Length: ' . strlen($res['body']));
    }
    echo $res['body'];
    if ($gzip) {
        ob_end_flush();
    }
}

// ---------------------------------------------------------------------------
// Static generator + CLI
// ---------------------------------------------------------------------------
function vh_mkdir($dir)
{
    if (!is_dir($dir) && !mkdir($dir, 0777, true) && !is_dir($dir)) {
        throw new RuntimeException('Cannot create directory ' . $dir);
    }
}

/**
 * @return array [abbr, files written, bytes written (plain), gzip bytes]
 */
function vh_build_static($dbPath, $outDir, array $opt)
{
    $gzip = !empty($opt['gzip']);
    $plain = empty($opt['no-plain']);
    $fmt = empty($opt['no-formatting']);
    $db = vh_open($dbPath);
    $meta = vh_meta($db);
    $abbr = (string)$meta['abbreviation'];
    if (!preg_match('/^[A-Za-z0-9_-]{1,16}$/', $abbr)) {
        throw new RuntimeException('Unsafe abbreviation: ' . $abbr);
    }
    $stats = array('abbr' => $abbr, 'files' => 0, 'bytes' => 0, 'gzbytes' => 0);
    $write = function ($path, $data) use (&$stats, $gzip, $plain) {
        vh_mkdir(dirname($path));
        if ($plain) {
            file_put_contents($path, $data);
            $stats['files']++;
            $stats['bytes'] += strlen($data);
        }
        if ($gzip && substr($path, -5) === '.json' && strpos($path, 'manifest.json') === false) {
            $gz = gzencode($data, 9);
            file_put_contents($path . '.gz', $gz);
            $stats['files']++;
            $stats['gzbytes'] += strlen($gz);
        }
    };
    $dir = rtrim($outDir, '/\\') . '/' . $abbr;
    for ($b = 1; $b <= 66; $b++) {
        $rows = $db->all(
            'SELECT verse_id, text, formatting FROM bible_verse WHERE verse_id BETWEEN ? AND ? ORDER BY verse_id',
            array($b * 1000000, $b * 1000000 + 999999)
        );
        $groups = array();
        foreach ($rows as $r) {
            $groups[intdiv((int)$r['verse_id'], 1000)][] = $r;
        }
        unset($rows);
        foreach ($groups as $k => $grp) {
            $json = vh_json(vh_slice($k, $grp, count($grp), $fmt));
            $write($dir . '/' . $b . '/' . ($k % 1000) . '.json', $json);
        }
    }
    $manifest = vh_json(vh_manifest_array($meta, vh_counts($db)));
    vh_mkdir($dir);
    file_put_contents($dir . '/manifest.json', $manifest);
    $stats['files']++;
    $stats['bytes'] += strlen($manifest);
    $db->close();

    // index.json: merge with existing, sorted by abbr
    $indexPath = rtrim($outDir, '/\\') . '/index.json';
    $index = array();
    if (is_file($indexPath)) {
        $old = json_decode((string)file_get_contents($indexPath), true);
        if (is_array($old)) {
            foreach ($old as $e) {
                if (is_array($e) && isset($e['abbr'], $e['name'], $e['lang']) && $e['abbr'] !== $abbr) {
                    $index[] = array('abbr' => (string)$e['abbr'], 'name' => (string)$e['name'], 'lang' => (string)$e['lang']);
                }
            }
        }
    }
    $index[] = array('abbr' => $abbr, 'name' => (string)$meta['full_name'], 'lang' => (string)$meta['language_code']);
    usort($index, function ($a, $b) {
        return strcmp($a['abbr'], $b['abbr']);
    });
    file_put_contents($indexPath, vh_json($index));
    $stats['files']++;
    return $stats;
}

function vh_cli_opts(array $args)
{
    $o = array();
    foreach ($args as $a) {
        if (preg_match('/^--([a-z-]+)(?:=(.*))?$/s', $a, $m)) {
            $o[$m[1]] = isset($m[2]) ? $m[2] : true;
        } else {
            throw new InvalidArgumentException('Unexpected argument: ' . $a);
        }
    }
    return $o;
}

function vh_cli(array $argv)
{
    $usage = "Usage:\n"
        . "  php verse-hover.php build-static --db=FILE --out=DIR [--gzip] [--no-plain] [--no-formatting] [--force-license]\n"
        . "  php verse-hover.php slim --db=FILE --out=FILE [--no-formatting]\n"
        . "  php verse-hover.php info --db=FILE\n";
    $cmd = isset($argv[1]) ? $argv[1] : '';
    try {
        $o = vh_cli_opts(array_slice($argv, 2));
    } catch (InvalidArgumentException $e) {
        fwrite(STDERR, $e->getMessage() . "\n" . $usage);
        return 1;
    }
    if (!in_array($cmd, array('build-static', 'slim', 'info'), true) || empty($o['db']) || !is_string($o['db'])) {
        fwrite(STDERR, $usage);
        return 1;
    }
    try {
        if ($cmd === 'info') {
            $db = vh_open($o['db']);
            $m = vh_meta($db);
            $c = $db->all('SELECT COUNT(*) AS n FROM bible_verse');
            $db->close();
            echo 'abbreviation: ' . $m['abbreviation'] . "\n";
            echo 'name: ' . $m['full_name'] . "\n";
            echo 'license: ' . ($m['license_spdx'] === null ? '(none)' : $m['license_spdx']) . "\n";
            echo 'verses: ' . $c[0]['n'] . "\n";
            return 0;
        }
        if (empty($o['out']) || !is_string($o['out'])) {
            fwrite(STDERR, $usage);
            return 1;
        }
        if ($cmd === 'build-static') {
            if (!empty($o['no-plain']) && empty($o['gzip'])) {
                fwrite(STDERR, "--no-plain requires --gzip\n");
                return 1;
            }
            $db = vh_open($o['db']);
            $m = vh_meta($db);
            $db->close();
            if (!vh_license_allowed($m['license_spdx']) && empty($o['force-license'])) {
                fwrite(STDERR, 'Refusing to build: license "' . ($m['license_spdx'] === null ? '' : $m['license_spdx'])
                    . "\" is not public domain or open. Use --force-license only if you have the right to publish this text.\n");
                return 2;
            }
            $s = vh_build_static($o['db'], $o['out'], $o);
            echo $s['abbr'] . ': ' . $s['files'] . ' files, ' . $s['bytes'] . ' bytes plain'
                . (empty($o['gzip']) ? '' : ', ' . $s['gzbytes'] . ' bytes gzip') . "\n";
            return 0;
        }
        // slim
        if (file_exists($o['out'])) {
            fwrite(STDERR, 'Output already exists: ' . $o['out'] . "\n");
            return 1;
        }
        $src = vh_open($o['db']);
        $ddl = $src->all("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'module_info'");
        $info = $src->all('SELECT * FROM module_info LIMIT 1');
        if (!$ddl || !$info) {
            throw new RuntimeException('Source has no module_info');
        }
        $dst = vh_open($o['out'], true);
        $dst->exec($ddl[0]['sql']);
        $cols = array_keys($info[0]);
        $dst->exec('INSERT INTO module_info (' . implode(',', $cols) . ') VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')', array_values($info[0]));
        $dst->exec('CREATE TABLE bible_verse (verse_id INTEGER PRIMARY KEY, text TEXT NOT NULL, formatting TEXT)');
        $dst->exec('BEGIN');
        $withFmt = empty($o['no-formatting']);
        $n = 0;
        for ($b = 1; $b <= 66; $b++) {
            $rows = $src->all(
                'SELECT verse_id, text, formatting FROM bible_verse WHERE verse_id BETWEEN ? AND ? ORDER BY verse_id',
                array($b * 1000000, $b * 1000000 + 999999)
            );
            foreach ($rows as $r) {
                $dst->exec('INSERT INTO bible_verse (verse_id, text, formatting) VALUES (?, ?, ?)', array((int)$r['verse_id'], (string)$r['text'], $withFmt ? $r['formatting'] : null));
                $n++;
            }
        }
        $dst->exec('COMMIT');
        $dst->close();
        $src->close();
        echo 'slim: ' . $n . ' verses -> ' . $o['out'] . "\n";
        return 0;
    } catch (Throwable $e) {
        fwrite(STDERR, 'Error: ' . $e->getMessage() . "\n");
        return 1;
    }
}

if (!defined('VH_NO_RUN')) {
    if (PHP_SAPI === 'cli') {
        $vhScript = isset($_SERVER['argv'][0]) ? realpath($_SERVER['argv'][0]) : false;
        if ($vhScript !== false && $vhScript === realpath(__FILE__)) {
            exit(vh_cli($_SERVER['argv']));
        }
    } else {
        vh_http();
    }
}
