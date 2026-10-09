// Each game registers its own views as a side effect of being imported, which is
// what keeps the shell free of a hard-coded list of games. A game missing from
// here renders as a placeholder rather than a broken screen, so the cost of
// forgetting one shows up the first time anybody plays it.
import './games/fill-in-the-blank/index.js';
import './games/name-that-reference/index.js';
import './games/sword-drill/index.js';
import './games/who-said-it/index.js';
import './games/who-am-i/index.js';
import './games/put-in-order/index.js';
import './games/category-board/index.js';
import './games/detective/index.js';
import './games/describe-it/index.js';
