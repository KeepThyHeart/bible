#!/usr/bin/env python3
import json
from collections import OrderedDict
import sys

# Define translations for each language following GLOSSARY style guide
translations = {
    "ar": {  # Arabic - Van Dyck terminology, masdar for labels
        "moduleManager.packs.tab": "حزم دون اتصال",
        "moduleManager.packs.title": "حزم دون اتصال",
        "moduleManager.packs.presetsHeading": "ابدأ من",
        "moduleManager.packs.groupsHeading": "المحتوى",
        "moduleManager.packs.empty": "لا توجد وحدات متاحة. حدّث الفهرس أولاً.",
        "moduleManager.packs.groupBible": "الكتب المقدسة",
        "moduleManager.packs.groupCommentary": "التفاسير",
        "moduleManager.packs.groupDictionary": "القواميس",
        "moduleManager.packs.groupCrossref": "الشواهد المرجعية",
        "moduleManager.packs.groupTopical": "الفهارس الموضوعية",
        "moduleManager.packs.groupOther": "أخرى",
        "moduleManager.packs.statusAbsent": "غير مثبتة",
        "moduleManager.packs.statusInstalled": "مثبتة",
        "moduleManager.packs.statusUpdate": "توفر تحديث",
        "moduleManager.packs.statusInstalling": "جاري التثبيت",
        "moduleManager.packs.statusError": "فشل",
        "moduleManager.packs.start": "تثبيت المختار",
        "moduleManager.packs.cancel": "توقف بعد هذه الوحدة",
        "moduleManager.packs.summaryDownload": "التحميل: {size}",
        "moduleManager.packs.summaryStored": "مساحة القرص: {size}",
        "moduleManager.packs.summaryFree": "مساحة حرة: {size}",
        "moduleManager.packs.summaryFreeUnknown": "مساحة حرة غير معروفة",
        "moduleManager.packs.fitFits": "يناسب",
        "moduleManager.packs.fitTight": "مساحة محدودة",
        "moduleManager.packs.fitNo": "مساحة غير كافية: {size} ناقص",
        "moduleManager.packs.fitUnknown": "لم يتم التحقق من المساحة",
        "moduleManager.packs.storageBarLabel": "مساحة القرص المستخدمة من قبل هذا الحزمة",
        "moduleManager.packs.runProgressLabel": "تقدم الحزمة",
        "moduleManager.packs.runCount": "{done} من {total}",
        "moduleManager.packs.runBytes": "{loaded} من {total}",
        "moduleManager.packs.runRunning": "تثبيت وحدة واحدة في المرة",
        "moduleManager.packs.runDone": "تم تثبيت كل شيء.",
        "moduleManager.packs.runPartial": "تعذر تثبيت بعض الوحدات.",
        "moduleManager.packs.runFailed": "تعذر تثبيت أي وحدة.",
        "moduleManager.packs.runCancelled": "توقف. تم الاحتفاظ بالوحدات المثبتة بالفعل.",
        "moduleManager.packs.warnDependency": "تمت إضافة {name} لأن {for} يحتاجها.",
        "moduleManager.packs.warnMissing": "يحتاج {name} إلى {requires}، التي غير متاحة.",
        "moduleManager.packs.warnUnavailable": "{name} غير متاح وتم تخطيه.",
        "moduleManager.packs.warnCycle": "هذه الوحدات تعتمد على بعضها: {names}.",
    },
    "hi": {  # Hindi - आप formal, polite imperative, Hindi for Bible-study vocabulary
        "moduleManager.packs.tab": "ऑफ़लाइन पैक",
        "moduleManager.packs.title": "ऑफ़लाइन पैक",
        "moduleManager.packs.presetsHeading": "यहाँ से शुरुएँ",
        "moduleManager.packs.groupsHeading": "विषय-वस्तु",
        "moduleManager.packs.empty": "कोई मॉड्यूल उपलब्ध नहीं है। पहले कैटलॉग को रीफ्रेश करें।",
        "moduleManager.packs.groupBible": "बाइबलें",
        "moduleManager.packs.groupCommentary": "टीका",
        "moduleManager.packs.groupDictionary": "शब्दकोश",
        "moduleManager.packs.groupCrossref": "सहसंदर्भ",
        "moduleManager.packs.groupTopical": "विषय अनुक्रमणिका",
        "moduleManager.packs.groupOther": "अन्य",
        "moduleManager.packs.statusAbsent": "स्थापित नहीं",
        "moduleManager.packs.statusInstalled": "स्थापित",
        "moduleManager.packs.statusUpdate": "अपडेट उपलब्ध",
        "moduleManager.packs.statusInstalling": "स्थापन जारी",
        "moduleManager.packs.statusError": "विफल",
        "moduleManager.packs.start": "चयनित स्थापित करें",
        "moduleManager.packs.cancel": "इस मॉड्यूल के बाद रोकें",
        "moduleManager.packs.summaryDownload": "डाउनलोड: {size}",
        "moduleManager.packs.summaryStored": "डिस्क स्पेस: {size}",
        "moduleManager.packs.summaryFree": "खाली: {size}",
        "moduleManager.packs.summaryFreeUnknown": "खाली स्पेस अज्ञात",
        "moduleManager.packs.fitFits": "फिट होता है",
        "moduleManager.packs.fitTight": "स्पेस में कसाव",
        "moduleManager.packs.fitNo": "पर्याप्त स्पेस नहीं: {size} कम",
        "moduleManager.packs.fitUnknown": "स्पेस की जाँच नहीं की गई",
        "moduleManager.packs.storageBarLabel": "इस पैक द्वारा प्रयुक्त डिस्क स्पेस",
        "moduleManager.packs.runProgressLabel": "पैक की प्रगति",
        "moduleManager.packs.runCount": "{done} का {total}",
        "moduleManager.packs.runBytes": "{loaded} का {total}",
        "moduleManager.packs.runRunning": "एक बार में एक मॉड्यूल स्थापित करें",
        "moduleManager.packs.runDone": "सब कुछ स्थापित है।",
        "moduleManager.packs.runPartial": "कुछ मॉड्यूल स्थापित नहीं हो सके।",
        "moduleManager.packs.runFailed": "कोई भी मॉड्यूल स्थापित नहीं हो सका।",
        "moduleManager.packs.runCancelled": "रोका गया। पहले से स्थापित मॉड्यूल को रखा गया।",
        "moduleManager.packs.warnDependency": "{name} जोड़ा गया क्योंकि {for} को इसकी आवश्यकता है।",
        "moduleManager.packs.warnMissing": "{name} को {requires} की आवश्यकता है, जो उपलब्ध नहीं है।",
        "moduleManager.packs.warnUnavailable": "{name} उपलब्ध नहीं है और छोड़ दिया गया।",
        "moduleManager.packs.warnCycle": "ये मॉड्यूल एक दूसरे पर निर्भर हैं: {names}।",
    },
    "pt-BR": {  # Portuguese (Brazil) - infinitive for labels, imperative for prose
        "moduleManager.packs.tab": "Pacotes offline",
        "moduleManager.packs.title": "Pacotes offline",
        "moduleManager.packs.presetsHeading": "Começar de",
        "moduleManager.packs.groupsHeading": "Conteúdo",
        "moduleManager.packs.empty": "Nenhum módulo disponível. Atualize o catálogo primeiro.",
        "moduleManager.packs.groupBible": "Bíblias",
        "moduleManager.packs.groupCommentary": "Comentários",
        "moduleManager.packs.groupDictionary": "Dicionários",
        "moduleManager.packs.groupCrossref": "Referências cruzadas",
        "moduleManager.packs.groupTopical": "Índices temáticos",
        "moduleManager.packs.groupOther": "Outros",
        "moduleManager.packs.statusAbsent": "Não instalado",
        "moduleManager.packs.statusInstalled": "Instalado",
        "moduleManager.packs.statusUpdate": "Atualização disponível",
        "moduleManager.packs.statusInstalling": "Instalando",
        "moduleManager.packs.statusError": "Falhou",
        "moduleManager.packs.start": "Instalar selecionado",
        "moduleManager.packs.cancel": "Parar após este módulo",
        "moduleManager.packs.summaryDownload": "Download: {size}",
        "moduleManager.packs.summaryStored": "Espaço em disco: {size}",
        "moduleManager.packs.summaryFree": "Livre: {size}",
        "moduleManager.packs.summaryFreeUnknown": "Espaço livre desconhecido",
        "moduleManager.packs.fitFits": "Cabe",
        "moduleManager.packs.fitTight": "Espaço apertado",
        "moduleManager.packs.fitNo": "Espaço insuficiente: faltam {size}",
        "moduleManager.packs.fitUnknown": "Espaço não verificado",
        "moduleManager.packs.storageBarLabel": "Espaço em disco usado por este pacote",
        "moduleManager.packs.runProgressLabel": "Progresso do pacote",
        "moduleManager.packs.runCount": "{done} de {total}",
        "moduleManager.packs.runBytes": "{loaded} de {total}",
        "moduleManager.packs.runRunning": "Instalando um módulo por vez",
        "moduleManager.packs.runDone": "Tudo está instalado.",
        "moduleManager.packs.runPartial": "Alguns módulos não puderam ser instalados.",
        "moduleManager.packs.runFailed": "Nenhum módulo pôde ser instalado.",
        "moduleManager.packs.runCancelled": "Parado. Os módulos já instalados foram mantidos.",
        "moduleManager.packs.warnDependency": "{name} foi adicionado porque {for} precisa dele.",
        "moduleManager.packs.warnMissing": "{name} precisa de {requires}, que não está disponível.",
        "moduleManager.packs.warnUnavailable": "{name} não está disponível e foi pulado.",
        "moduleManager.packs.warnCycle": "Estes módulos dependem um do outro: {names}.",
    },
    "ru": {  # Russian - Synodal terminology, noun or perfective infinitive
        "moduleManager.packs.tab": "Автономные пакеты",
        "moduleManager.packs.title": "Автономные пакеты",
        "moduleManager.packs.presetsHeading": "Начать с",
        "moduleManager.packs.groupsHeading": "Содержание",
        "moduleManager.packs.empty": "Модули недоступны. Сначала обновите каталог.",
        "moduleManager.packs.groupBible": "Библии",
        "moduleManager.packs.groupCommentary": "Комментарии",
        "moduleManager.packs.groupDictionary": "Словари",
        "moduleManager.packs.groupCrossref": "Перекрёстные ссылки",
        "moduleManager.packs.groupTopical": "Тематические указатели",
        "moduleManager.packs.groupOther": "Другое",
        "moduleManager.packs.statusAbsent": "Не установлено",
        "moduleManager.packs.statusInstalled": "Установлено",
        "moduleManager.packs.statusUpdate": "Доступно обновление",
        "moduleManager.packs.statusInstalling": "Установка",
        "moduleManager.packs.statusError": "Ошибка",
        "moduleManager.packs.start": "Установить выбранное",
        "moduleManager.packs.cancel": "Остановить после этого модуля",
        "moduleManager.packs.summaryDownload": "Загрузка: {size}",
        "moduleManager.packs.summaryStored": "Место на диске: {size}",
        "moduleManager.packs.summaryFree": "Свободно: {size}",
        "moduleManager.packs.summaryFreeUnknown": "Свободное место неизвестно",
        "moduleManager.packs.fitFits": "Подходит",
        "moduleManager.packs.fitTight": "Мало места",
        "moduleManager.packs.fitNo": "Недостаточно места: не хватает {size}",
        "moduleManager.packs.fitUnknown": "Место не проверено",
        "moduleManager.packs.storageBarLabel": "Место на диске, занятое этим пакетом",
        "moduleManager.packs.runProgressLabel": "Ход выполнения пакета",
        "moduleManager.packs.runCount": "{done} из {total}",
        "moduleManager.packs.runBytes": "{loaded} из {total}",
        "moduleManager.packs.runRunning": "Установка по одному модулю за раз",
        "moduleManager.packs.runDone": "Всё установлено.",
        "moduleManager.packs.runPartial": "Некоторые модули не удалось установить.",
        "moduleManager.packs.runFailed": "Ни один модуль не удалось установить.",
        "moduleManager.packs.runCancelled": "Остановлено. Уже установленные модули сохранены.",
        "moduleManager.packs.warnDependency": "{name} добавлен, так как {for} его требует.",
        "moduleManager.packs.warnMissing": "{name} требует {requires}, которая недоступна.",
        "moduleManager.packs.warnUnavailable": "{name} недоступен и пропущен.",
        "moduleManager.packs.warnCycle": "Эти модули зависят друг от друга: {names}.",
    },
}

def process_locale(locale_code):
    """Process a single locale file."""
    file_path = f'apps/desktop/locales/{locale_code}/ui.json'

    # Read the file
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Track if file has trailing newline
    has_trailing_newline = content.endswith('\n')

    # Load JSON with OrderedDict to preserve order
    data = json.loads(content, object_pairs_hook=OrderedDict)

    # Verify we can reproduce the file byte-for-byte (for first pass)
    dumped = json.dumps(data, ensure_ascii=False, indent=2)
    if has_trailing_newline:
        dumped += '\n'

    if dumped == content:
        print(f"✓ {locale_code}: Verified byte-for-byte reproduction")
    else:
        print(f"⚠ {locale_code}: Byte-for-byte reproduction differs")
        # Show the difference size
        print(f"  Original: {len(content)} bytes, Regenerated: {len(dumped)} bytes")

    # Add translations if they exist for this locale
    if locale_code in translations:
        for key, value in translations[locale_code].items():
            if key not in data:
                data[key] = value
                print(f"  Added: {key}")
            else:
                print(f"  Key already exists: {key}")

        # Write back the file
        output = json.dumps(data, ensure_ascii=False, indent=2)
        if has_trailing_newline:
            output += '\n'

        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(output)

        print(f"✓ {locale_code}: Updated with {len(translations[locale_code])} keys")
    else:
        print(f"✗ {locale_code}: No translations defined")

# Process each locale
locales = ['ar', 'hi', 'pt-BR', 'ru']
for locale in locales:
    print(f"\nProcessing {locale}...")
    process_locale(locale)

print("\n✓ All locales processed!")
