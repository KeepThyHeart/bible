<?php
// Copy to verse-hover.config.php (next to verse-hover.php) and edit.
// Without this file, every *.db next to verse-hover.php is auto-discovered by its module_info.abbreviation.
return array(
    // Translation abbreviation => database path (absolute, or relative to this directory).
    // The request can never choose a path; it can only pick one of these keys.
    'translations' => array(
        'KJV' => '/var/data/bible/bible_kjv.db',
    ),
    // Empty array = "Access-Control-Allow-Origin: *". Otherwise only listed origins are echoed.
    'allowed_origins' => array(),
    // Cache-Control max-age in seconds.
    'cache_ttl' => 86400,
);
