# Bible-Study Terminology Glossary

This glossary fixes the agreed rendering of domain terminology across every locale shipped with the app. **Translators must follow it.** Bible-study vocabulary has established renderings in each language's Christian publishing tradition, and a plausible-but-wrong choice (Spanish *verso* instead of *versículo*, for example) is exactly what makes a seminary user stop trusting the software.

If you disagree with an entry, change it *here first* and then sweep the catalogs - do not diverge locally in one file.

Related docs: [`README.md`](README.md) (how to add a locale, ICU rules, tooling).

---

## Status of each language

| Locale | Language | Status | Reviewed by a native speaker? |
|---|---|---|---|
| `en` | English | source of truth | n/a |
| `es` | Spanish | **draft (machine-drafted)** | No - review wanted |
| `ar` | Arabic | **draft (machine-drafted)** | No - review wanted |
| `pt-BR` | Portuguese (Brazil) | **draft (machine-drafted)** | No - review wanted |
| `ru` | Russian | **draft (machine-drafted)** | No - review wanted |
| `hi` | Hindi | **draft (machine-drafted)** | No - review wanted |
| `zh-Hans` | Chinese (Simplified) | **draft (machine-drafted)** | No - review wanted |

Every locale also carries a `locale.notes` field in its `meta.json` recording the Scripture edition used for the font sample, the copyrighted editions that must not be substituted for it, and any terminology call a reviewer is likely to want to revisit. Read it before changing a locale.

---

## Register and style, per language

### Spanish (`es`) - DECIDED

* **Register: impersonal / infinitive.** Buttons, menu items, commands and tooltips use the bare infinitive: *Buscar*, *Guardar*, *Cerrar pestaña*, *Seleccionar diccionario*. This is the dominant convention in Spanish software UI (Microsoft, GNOME, Apple ES style guides) and it dodges the tú/usted question entirely for the ~90 % of strings that are labels.
* **Never *tú*, never *vos*.** Where a sentence genuinely cannot avoid addressing the reader - mostly the in-app documentation prose - use the **impersonal *se*** (*Se puede contraer este panel*) or recast the sentence with the feature as subject (*Este panel se puede contraer*). If direct address is truly unavoidable, use **usted** (third-person verb forms), which is neutral across Spain and Latin America. Do not mix the two registers inside one paragraph.
* **Possessives:** *sus notas*, *su contraseña* (usted-compatible). Better still, drop the possessive where Spanish does not need it: *Exportar notas*, not *Exportar sus notas*.
* **Neutral Spanish.** Avoid regionalisms. Prefer *ordenador*/*computadora*-free wordings (*el equipo*, *el dispositivo*) where possible; when unavoidable use *el equipo*.
* **Capitalization:** Spanish uses sentence case, not English Title Case. UI labels are *Búsqueda avanzada*, not *Búsqueda Avanzada*. Proper nouns keep their capitals: *Antiguo Testamento*, *Nuevo Testamento*, *Evangelios*, *Escritura*.
* **Punctuation:** opening `¿` and `¡` are mandatory. Use `«»` or `"` for quotes consistently - the catalogs use `"` because several strings quote UI labels.

### Arabic (`ar`) - DECIDED

* **Modern Standard Arabic**, Van Dyck terminology base (see the tables below).
* **Register: masdar for labels, imperative for prose.** Buttons and menu items use the verbal noun - *بحث*, *إغلاق علامة التبويب*, *تصدير الملاحظات* - which is the dominant Arabic software convention. The in-app documentation addresses the reader with the masculine singular imperative (*انقر*, *استخدم*, *حدِّد*), matching Microsoft/GNOME Arabic style guides.
* **Verse/chapter/book vocabulary follows the Van Dyck tradition**: سفر (book), أصحاح (chapter), عدد (verse). This is deliberate - the Scripture sample is Van Dyck, and mixing its structural vocabulary with the Catholic/modern آية / فصل convention inside one UI reads as sloppy. A reviewer who prefers آية should change this table first, then sweep.
* **آية is avoided for "verse"** for the additional reason that it is the ordinary word for a Qur'anic verse; عدد is unambiguous in a Christian Bible-study context.
* **Punctuation:** use Arabic comma `،` and Arabic question mark `؟`. Use `« »` for quotes.
* **Digits:** write Western digits (`14`, `3:16`) in the source strings. ICU renders `#` in plural blocks using the locale's own numbering system.
* **RTL hazard:** strings naming a physical direction - `layout.*.description`, `*.splitRight`, `*.splitDown`, the "left/right arrows" documentation - are translated literally (يسار = left, يمين = right). If the RTL work mirrors the pane geometry, these become wrong and must be revisited together.

### Portuguese (`pt-BR`) - DECIDED

* **Brazilian Portuguese only.** The `pt-BR` tag is deliberate: *Salvar* (BR) vs *Guardar* (PT), *aba* (BR) vs *separador* (PT), *tela* vs *ecrã*, and *backup* vs *cópia de segurança* are hard fork points, and a "neutral `pt`" satisfies neither audience. If European Portuguese is wanted later, add `pt-PT`; do not water this one down.
* **Register: infinitive for labels, imperative for prose.** Labels and commands use the infinitive (*Pesquisar*, *Exportar minhas notas*, *Fechar a aba*); the documentation addresses the reader directly with the imperative (*Clique*, *Use*, *Selecione*), which is the normal Brazilian convention.
* ***você* is acceptable** in documentation prose and is used; do not switch to *tu*, and do not mix the two.
* **Capitalization:** sentence case, as in Spanish. *Pesquisa avançada*, not *Pesquisa Avançada*.

### Russian (`ru`) - DECIDED

* **Terminology base: Синодальный перевод (Synodal, 1876).** It is what Russian-speaking seminaries use, and it is public domain.
* **Register: noun or imperative, per Russian UI convention.** Commands and buttons are nouns where the English is a noun (*Поиск*, *Экспорт*) and perfective infinitives where it is a verb (*Сохранить*, *Закрыть вкладку*). Documentation prose uses the polite plural imperative (*Нажмите*, *Используйте*).
* **Avoid *ваш* where Russian does not need it**: *Экспорт заметок*, not *Экспорт ваших заметок*.
* **Use ё** where it is distinguishing (*перекрёстная ссылка*, *нечёткий*) - the catalogs are consistent about it.
* **Length:** Russian runs 15-30 % longer than English. Re-check anything that sits in a narrow control.

### Hindi (`hi`) - DECIDED

* **Register: आप (formal) throughout**, with the polite imperative in -एँ / -ें (*करें*, *चुनें*, *देखें*).
* **Loan-word policy: keep English loans for computing chrome, use Hindi for Bible-study vocabulary.** So टैब, बुकमार्क, टेम्पलेट, मॉड्यूल, हाइलाइट, फ़ॉन्ट, बैकअप - but पद, अध्याय, टीका, शब्दकोश, पवित्रशास्त्र. Mixing the other way round (translating "tab" or transliterating "verse") is what reads wrong to Hindi Christian readers.
* **Sentence-final punctuation is the danda `।`**, not a full stop - except where a string ends in an ellipsis (`...`) or is a fragment/label.
* Warning: **`सहसंदर्भ` for "cross-reference" is a coined term** and the weakest entry in this glossary. Hindi Christian publishing has no settled rendering; संदर्भ alone is already taken by "reference". A native reviewer should decide this one and sweep it.
* **No Scripture is quoted in this locale** - see `hi/meta.json`.

### Chinese, Simplified (`zh-Hans`) - DECIDED

* **Terminology base: 和合本 (Chinese Union Version).** It is the de-facto standard for Protestant Chinese Bible study.
* **Divine name: 神版, never 上帝版.** Every UI string referring to God uses 神. This follows the edition predominantly used by the orthodox/house evangelical church in mainland China. Printed 神版 Bibles set a space before 神 purely to keep line lengths matching the 上帝版 typesetting; that is a typesetting artifact and is **not** reproduced in the catalogs.
* **Simplified characters only** (the locale tag says so). Do not import Taiwanese Protestant vocabulary wholesale - 斯特朗编号, not 史特朗編號.
* **Punctuation is full-width**: `，。、：（）「」` and `“ ”` for quotes. An ASCII comma or period inside Chinese prose is a defect.
* **No plurals.** Chinese has a single CLDR plural category; write a plain `{count}` rather than a one-branch ICU `plural` block.
* **串珠** is used for "cross-reference" - the established term in Chinese study Bibles - rather than a literal 交叉引用.

---

## Core terminology

Fill a column only when that language is actually being worked on. `-` means "not yet decided"; do not guess in a catalog file without updating this table.

### Scripture structure

| English | Spanish (`es`) | Portuguese (`pt-BR`) | Russian (`ru`) | Hindi (`hi`) | zh-Hans | Arabic (`ar`) | Notes |
|---|---|---|---|---|---|---|---|
| Bible | Biblia | Bíblia | Библия | बाइबल | 圣经 | الكتاب المقدس | |
| Scripture / the Scriptures | Escritura / las Escrituras | Escritura / as Escrituras | Писание / Священное Писание | पवित्रशास्त्र | 圣经 / 经文 | الكتاب المقدس / الأسفار المقدسة | Capitalized when it means the Bible |
| verse | **versículo** | **versículo** | стих | **पद** | 节 / 经节 | **عدد** (pl. أعداد) | Warning: ES: NOT *verso*. HI: NOT *आयत*. AR: NOT *آية* - see the Arabic register note. |
| chapter | capítulo | capítulo | глава | अध्याय | 章 | أصحاح | |
| passage | pasaje | passagem | отрывок | अंश | 经文 / 段落 | مقطع | Not *paso*, not *porción* |
| book (of the Bible) | libro | livro | книга | पुस्तक | 书卷 | سفر (pl. أسفار) | |
| verse range | intervalo de versículos | intervalo de versículos | диапазон стихов | पद सीमा | 经节范围 | نطاق الأعداد | |
| reference (Scripture) | referencia | referência | ссылка | संदर्भ | 经文出处 | مرجع | |
| Old Testament | Antiguo Testamento | Antigo Testamento | Ветхий Завет | पुराना नियम | 旧约 | العهد القديم | Abbrev. AT / ВЗ |
| New Testament | Nuevo Testamento | Novo Testamento | Новый Завет | नया नियम | 新约 | العهد الجديد | Abbrev. NT / НЗ |
| Gospels | Evangelios | Evangelhos | Евангелия | सुसमाचार | 福音书 | الأناجيل | |
| translation / version | traducción / versión | tradução / versão | перевод / версия | अनुवाद / संस्करण | 译本 / 版本 | ترجمة / نسخة | Both used; the second for the dropdown, the first in prose |
| versification | versificación | versificação | нумерация стихов | पद-क्रमांकन | 经节编排 | ترقيم الأعداد | |

### Study resources

| English | Spanish (`es`) | Portuguese (`pt-BR`) | Russian (`ru`) | Hindi (`hi`) | zh-Hans | Arabic (`ar`) | Notes |
|---|---|---|---|---|---|---|---|
| commentary | comentario | comentário | комментарий | टीका | 注释 | تفسير (pl. تفاسير) | RU: *толкование* is the seminary word for the genre; *комментарий* is used in the UI because it also names the module type. |
| concordance | concordancia | concordância | **симфония** | शब्द-अनुक्रमणिका | 经文汇编 | الفهرس التحليلي | Warning: RU: NOT *конкорданс* - *симфония* is the established Russian biblical-studies term. |
| lexicon | léxico | léxico | лексикон | कोश | 辞典 | معجم | Warning: ES: NOT *lexicón*. |
| dictionary | diccionario | dicionário | словарь | शब्दकोश | 词典 | قاموس | |
| interlinear | interlineal | interlinear | **подстрочник** | अंतरपंक्तिक | 原文对照 | بين السطور | Adjective in most languages; RU uses the noun *подстрочник*. |
| cross-reference | **referencia cruzada** | **referência cruzada** | перекрёстная ссылка | **सहसंदर्भ** | **串珠** | شاهد مرجعي (pl. الشواهد المرجعية) | Warning: ES: NOT *referencia transversal*. HI: coined, see the Hindi register note. ZH: 串珠 is the study-Bible term, not 交叉引用. |
| Strong's number | **número Strong** | **número Strong** | номер Стронга | स्ट्रॉन्ग संख्या | 斯特朗编号 | رقم سترونج | Do not translate "Strong". ZH: 斯特朗 (mainland), not 史特朗. |
| morphology | morfología | morfologia | морфология | रूपविज्ञान | 词法 | الصرف | |
| morphology code | código morfológico | código morfológico | морфологический код | रूपविज्ञान कोड | 词法代码 | رمز صرفي | |
| part of speech | categoría gramatical | classe gramatical | часть речи | शब्द-भेद | 词性 | قسم الكلام | |
| transliteration | transliteración | transliteração | транслитерация | लिप्यंतरण | 音译 | الكتابة الصوتية | |
| original languages | lenguas originales | línguas originais | языки оригинала | मूल भाषाएँ | 原文 | اللغات الأصلية | Not *idiomas originales* in a scholarly register |
| Greek / Hebrew | griego / hebreo | grego / hebraico | греческий / еврейский | यूनानी / इब्रानी | 希腊文 / 希伯来文 | اليونانية / العبرية | HI: यूनानी/इब्रानी are the Hindi Bible's own words, not ग्रीक/हिब्रू. |
| word study | estudio de palabras | estudo de palavras | изучение слов | शब्द अध्ययन | 字词研究 | دراسة الكلمات | |
| devotional (n.) | devocional | devocional | размышление | मनन | 灵修 | تأمل (pl. تأملات) | |
| reading plan | plan de lectura | plano de leitura | план чтения | पठन योजना | 读经计划 | خطة قراءة | |
| topical index | índice temático | índice temático | тематический указатель | विषय अनुक्रमणिका | 主题索引 | فهرس موضوعي | |
| topic | tema | tema | тема | विषय | 主题 | موضوع | *Sub-topics* -> *Subtemas* / *Подтемы* / उप-विषय / 子主题 / الموضوعات الفرعية |
| footnote | nota al pie | nota de rodapé | сноска | पादटिप्पणी | 脚注 | حاشية | |
| section heading | encabezado de sección | título de seção | заголовок раздела | अनुभाग शीर्षक | 段落标题 | عنوان قسم | |
| red-letter (words of Christ) | palabras de Cristo en rojo | palavras de Cristo em vermelho | слова Христа красным | मसीह के वचन लाल रंग में | 基督的话用红色显示 | كلمات المسيح بالأحمر | |
| module | módulo | módulo | модуль | मॉड्यूल | 模块 | وحدة (pl. وحدات) | |
| repository (module source) | repositorio | repositório | репозиторий | रिपॉज़िटरी | 资源库 | مستودع | |
| table of contents | índice de contenido | sumário | оглавление | विषय-सूची | 目录 | فهرس المحتويات | Warning: PT-BR: *sumário*, not *índice* (which is an alphabetical index at the back). Distinct from *topical index* above. |
| Module Manager | gestor de módulos | gerenciador de módulos | менеджер модулей | मॉड्यूल प्रबंधक | 模块管理器 | مدير الوحدات | The dialog that installs and removes modules |
| doctrine | doctrina | doutrina | учение | शिक्षा | 教义 | تعليم (pl. تعاليم) | |
| **false doctrine** | **falsa doctrina** | **falsa doutrina** | **ложное учение** | **झूठी शिक्षा** | **错误的教义** | **تعليم كاذب** (pl. تعاليم كاذبة) | Warning: Appears in `moduleDisclaimer.digest.caution`, a disclosure notice about machine-generated commentary. **Do not soften it** - it is the point of the sentence. ZH: 错误的教义, NOT 异端 (that means *heresy* specifically and over-translates a general caution). AR: كاذب follows Van Dyck's مُعَلِّمُونَ كَذَبَةٌ (2 Pet. 2:1) rather than باطل. RU: *ложное учение* is the standard phrase; *лжеучение* as one word is also correct and a reviewer may prefer it. |

### User content

| English | Spanish (`es`) | Portuguese (`pt-BR`) | Russian (`ru`) | Hindi (`hi`) | zh-Hans | Arabic (`ar`) | Notes |
|---|---|---|---|---|---|---|---|
| note | nota | nota | заметка | टिप्पणी | 笔记 | ملاحظة | |
| verse note | nota de versículo | nota de versículo | заметка к стиху | पद टिप्पणी | 经节笔记 | ملاحظة العدد | |
| document | documento | documento | документ | दस्तावेज़ | 文档 | مستند | Long-form writing, not verse-bound |
| journal | diario | diário | дневник | डायरी | 日志 | المذكرات | Warning: ES: NOT *periódico*, NOT *revista* |
| journal entry | entrada del diario | entrada do diário | запись дневника | डायरी प्रविष्टि | 日志条目 | مدخل المذكرات | |
| prayer | oración | oração | молитва | प्रार्थना | 祷告 | صلاة | |
| prayer list | lista de oración | lista de oração | молитвенный список | प्रार्थना सूची | 祷告清单 | قائمة الصلاة | |
| prayer request | petición de oración | pedido de oração | молитвенная просьба | प्रार्थना निवेदन | 代祷事项 | طلب صلاة | |
| answered (prayer) | respondida | respondida | отвеченная | उत्तरित | 已蒙应允 | مستجابة | |
| highlight (n. / v.) | **resaltado / resaltar** | **destaque / destacar** | выделение / выделить | हाइलाइट / हाइलाइट करना | 高亮 | تظليل | Warning: ES: NOT *destacar*, NOT *subrayar*. PT-BR: *destacar* is what Brazilian Bible apps use; *realçar* is the Office term and reads like a word processor. |
| underline | subrayado / subrayar | sublinhado / sublinhar | подчёркивание / подчеркнуть | रेखांकन / रेखांकित करना | 下划线 | تسطير | |
| annotation | anotación | anotação | пометка | एनोटेशन | 批注 | تعليق | |
| bookmark (n. / v.) | marcador / añadir marcador | marcador / marcar | закладка | बुकमार्क | 书签 | علامة مرجعية | Warning: ES: NOT *favorito* - these are Scripture bookmarks, not browser favourites. |
| collection | colección | coleção | коллекция | संग्रह | 收藏集 | مجموعة | |
| tag | etiqueta | etiqueta | метка | टैग | 标签 | وسم | |
| template | plantilla | modelo | шаблон | टेम्पलेट | 模板 | قالب | Warning: PT-BR: *modelo*, not *plantilha*/*template*. |
| sermon outline | **bosquejo de sermón** | **esboço de sermão** | план проповеди | उपदेश की रूपरेखा | 讲道大纲 | مخطط العظة | Warning: ES: *bosquejo* is the homiletics term; NOT *esquema*, NOT *guion*. PT-BR: *esboço*, likewise. |
| expository outline | bosquejo expositivo | esboço expositivo | экспозиционный план | व्याख्यात्मक रूपरेखा | 释经大纲 | مخطط تفسيري | |
| topical study | estudio temático | estudo temático | тематическое исследование | विषयगत अध्ययन | 专题研经 | دراسة موضوعية | |
| observation / interpretation / application | observación / interpretación / aplicación | observação / interpretação / aplicação | наблюдение / толкование / применение | अवलोकन / व्याख्या / अनुप्रयोग | 观察 / 解释 / 应用 | ملاحظة / تفسير / تطبيق | The standard inductive-study triad |
| reflection | reflexión | reflexão | размышление | मनन | 反思 | تأمل | |

### Application / UI chrome

| English | Spanish (`es`) | Portuguese (`pt-BR`) | Russian (`ru`) | Hindi (`hi`) | zh-Hans | Arabic (`ar`) | Notes |
|---|---|---|---|---|---|---|---|
| pane | panel | painel | панель | फलक | 窗格 | جزء | |
| tab | pestaña | aba | вкладка | टैब | 标签页 | علامة تبويب | PT-BR: *aba*, not *guia* (Office) and not *separador* (PT). |
| layout (of panes) | diseño | layout | макет | लेआउट | 布局 | تخطيط | |
| session | sesión | sessão | сеанс | सत्र | 会话 | جلسة | |
| parallel view | vista paralela | visualização paralela | параллельный просмотр | समानांतर दृश्य | 平行对照 | عرض متوازٍ | |
| display mode | modo de visualización | modo de exibição | режим отображения | प्रदर्शन मोड | 显示模式 | وضع العرض | |
| search (n. / v.) | búsqueda / buscar | pesquisa / pesquisar | поиск / искать | खोज / खोजें | 搜索 | بحث | |
| advanced search | búsqueda avanzada | pesquisa avançada | расширенный поиск | उन्नत खोज | 高级搜索 | بحث متقدم | Sentence case |
| fuzzy search | **búsqueda aproximada** | **pesquisa aproximada** | нечёткий поиск | अनुमानित खोज | 模糊搜索 | بحث تقريبي | Warning: ES: NOT *búsqueda difusa*. RU *нечёткий поиск* is genuinely standard and is kept. |
| proximity search | búsqueda por proximidad | pesquisa por proximidade | поиск по близости | निकटता खोज | 邻近搜索 | بحث بالتقارب | |
| whole word | palabra completa | palavra inteira | слово целиком | पूरा शब्द | 全词匹配 | كلمة كاملة | |
| case sensitive | distinguir mayúsculas y minúsculas | diferenciar maiúsculas de minúsculas | учитывать регистр | अक्षर-आकार का ध्यान रखें | 区分大小写 | مطابقة حالة الأحرف | |
| scope | ámbito | escopo | область поиска | दायरा | 范围 | نطاق | Not *alcance* for a search scope selector |
| backup (n.) | copia de seguridad | backup | резервная копия | बैकअप | 备份 | نسخة احتياطية | Warning: ES: NOT *respaldo*, NOT *backup*. PT-BR: *backup* **is** the Brazilian norm - the ES rule does not carry over. |
| restore | restaurar | restaurar | восстановление | पुनर्स्थापना | 还原 | استعادة | |
| merge / replace | combinar / reemplazar | mesclar / substituir | объединить / заменить | मिलाएँ / बदलें | 合并 / 替换 | دمج / استبدال | |
| export / import | exportar / importar | exportar / importar | экспорт / импорт | निर्यात / आयात | 导出 / 导入 | تصدير / استيراد | |
| pop out (to a window) | desacoplar | desacoplar | открепить | अलग विंडो में खोलें | 弹出到独立窗口 | فصل في نافذة مستقلة | PT-BR deliberately avoids *destacar* here - it already means "highlight". |
| split right / split down | dividir a la derecha / dividir abajo | dividir à direita / dividir abaixo | разделить вправо / разделить вниз | दाईं ओर विभाजित करें / नीचे विभाजित करें | 向右拆分 / 向下拆分 | تقسيم إلى اليمين / تقسيم إلى الأسفل | Warning: Physical directions. Revisit for `ar` if RTL mirrors the pane geometry. |
| preferences / settings | preferencias / configuración | preferências / configurações | параметры / настройки | वरीयताएँ / सेटिंग्स | 首选项 / 设置 | تفضيلات / إعدادات | The first for the dialog, the second for a group of options |
| keyboard shortcut | atajo de teclado | atalho de teclado | сочетание клавиш | कीबोर्ड शॉर्टकट | 键盘快捷键 | اختصار لوحة المفاتيح | |
| command palette | paleta de comandos | paleta de comandos | палитра команд | कमांड पैलेट | 命令面板 | لوحة الأوامر | |
| theme | tema | tema | тема | थीम | 主题 | سمة | Warning: ZH: 主题 collides with *topic* (topical index). Context disambiguates - 主题 for the visual theme is what every Chinese UI uses - but do not merge the two entries. |
| font | fuente | fonte | шрифт | फ़ॉन्ट | 字体 | الخط | ES: *fuente*, not *tipo de letra*, matching the rest of the dialog. |
| font size | tamaño de fuente | tamanho da fonte | размер шрифта | फ़ॉन्ट आकार | 字号 | حجم الخط | |
| line height / line spacing | interlineado | entrelinha | межстрочный интервал | पंक्ति ऊँचाई | 行高 | ارتفاع السطر | |
| preview | vista previa | prévia | предварительный просмотр | पूर्वावलोकन | 预览 | معاينة | |

### Pane names

The agreed name for each pane, for any message that has to name one. These live in the catalog as **`paneName.*`** and are the single source for both the per-pane font panels in Preferences (`PreferencesDialog/FontsSection.tsx`) and the dockview tab titles (`DockviewTabRenderer.tsx`, via `src/ui/utils/paneNames.ts`).

| English | Key | Spanish (`es`) | Portuguese (`pt-BR`) | Russian (`ru`) | Hindi (`hi`) | zh-Hans | Arabic (`ar`) | Notes |
|---|---|---|---|---|---|---|---|---|
| Bible (pane) | `paneName.bible` | Biblia | Bíblia | Библия | बाइबल | 圣经 | الكتاب المقدس | |
| Commentary (pane) | `paneName.commentary` | Comentario | Comentário | Комментарий | टीका | 注释 | التفسير | |
| Book (pane) | `paneName.book` | Libro | Livro | Книга | पुस्तक | 书籍 | الكتاب | Warning: This is a **study book** module, not a book *of the Bible*. ZH: 书籍, NOT 书卷 (which means a Bible book). AR: كتاب, NOT سفر, for the same reason. |
| Dictionary (pane) | `paneName.dictionary` | Diccionario | Dicionário | Словарь | शब्दकोश | 词典 | القاموس | |
| Notes (pane) | `paneName.notes` | Notas | Notas | Заметки | टिप्पणियाँ | 笔记 | الملاحظات | Plural - the pane holds many notes. Singular *note* is in **User content** above. |
| Prayer (pane) | `paneName.prayer` | Oración | Oração | Молитва | प्रार्थना | 祷告 | الصلاة | |
| Search (pane) | `paneName.search` | Búsqueda | Pesquisa | Поиск | खोज | 搜索 | بحث | The noun, not the verb - it names a pane. |
| Study (pane) | `paneName.study` | Estudio | Estudo | Изучение | अध्ययन | 研经 | الدراسة | The study-tools hub pane. ZH: 研经 (Scripture study), not 学习 (schoolwork). |
| Topics (pane) | `paneName.topics` | Temas | Temas | Темы | विषय | 主题 | الموضوعات | The topical-index browser. Same word as *topic* above. |
| New Tab (pane) | `paneName.newTab` | Nueva pestaña | Nova aba | Новая вкладка | नया टैब | 新标签页 | علامة تبويب جديدة | The empty placeholder tab. Uses each language's word for *tab* from **Application / UI chrome**. |

These are deliberately **bare nouns**, not whole noun phrases such as "Bible pane". The word for *pane* lives in the surrounding message, so a language that needs case agreement (Russian *на панели ...*) or a construct state (Arabic *جزء ...*) can inflect its own words. Every locale that inflects frames the name appositively - `панель «Библия»`, `جزء «الكتاب المقدس»`, `painel “Bíblia”` - so the nominative/citation form is always the right one to supply.

The surrounding message for the Preferences font panels is **`preferencesDialog.paneFontLabel`** (`en`: `"{paneName} Pane"`). That is where each language puts its own word for *pane* and its own quotation marks - `Panel «{paneName}»`, `Панель «{paneName}»`, `جزء «{paneName}»`, `{paneName} फलक`, `{paneName}窗格`. In the dockview tab strip the name appears **alone**, with no frame at all, which is the other reason these have to be bare nouns.

### Theme names

| English | Spanish (`es`) | Portuguese (`pt-BR`) | Russian (`ru`) | Hindi (`hi`) | zh-Hans | Arabic (`ar`) | Notes |
|---|---|---|---|---|---|---|---|
| Light (theme) | Claro | Claro | Светлая | हल्का | 浅色 | فاتح | RU agrees with *тема* (f). HI uses the default (masculine) form - Hindi UIs do not inflect a bare theme-card label. |
| Dark (theme) | Oscuro | Escuro | Тёмная | गहरा | 深色 | داكن | ZH: 深色, not 夜间/黑暗 - 浅色/深色 is the standard pair. |
| Sepia (theme) | Sepia | Sépia | Сепия | सेपिया | 棕褐色 | سيبيا | Warning: Most languages borrow the word; **Chinese does not** - 棕褐色 is the established rendering and a transliteration would be meaningless. |

---

## Product name

The product name is a **build-time setting** (`BIBLE_PRODUCT_NAME`). Never translate or localize it, and never bake a product name into a catalog string.

Every string that names the product takes a **`{productName}` placeholder** (and `documentationDialog.footerVersion` also takes `{version}`). Move the placeholder wherever your language's word order requires, but keep it - a literal product name in a catalog silently defeats the branding setting.

## Things that are never translated

* ICU placeholder names - `{count}`, `{reference}`, `{presetName}`.
* Copy-template variables - `{book}`, `{chapter}`, `{verse_range}`, `{version}`, `{nl}`, `{verses}`, `{num}`, `{text}`. These are parsed by the copy engine and are **not** ICU; they must survive byte-for-byte.
* Key names and HTML in strings - `<strong>`, `<kbd>`, `Ctrl`, `Alt`, `Shift`, `Enter`, `Esc`, `Cmd`. Key *names* stay English because that is what is printed on the keyboard. (`Ctrl+K` stays `Ctrl+K`.)
* Strong's number prefixes `G` / `H`, and the numbers themselves.
* Module abbreviations and language tags (`KJV`, `[ESP]`).
* `Aa` (the typography icon glyph).
