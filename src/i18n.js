/**
 * i18n.js
 * Arabic / English toggle with RTL support.
 */

export class I18n {
  constructor() {
    this.lang = 'en';
  }

  toggle() {
    this.lang = this.lang === 'en' ? 'ar' : 'en';
    this._apply();
    return this.lang;
  }

  _apply() {
    const isAr = this.lang === 'ar';
    document.documentElement.setAttribute('lang', this.lang);
    document.documentElement.setAttribute('dir', isAr ? 'rtl' : 'ltr');
    document.body.setAttribute('dir', isAr ? 'rtl' : 'ltr');

    // Update all elements with data-en / data-ar
    document.querySelectorAll('[data-en]').forEach(el => {
      const txt = el.getAttribute(isAr ? 'data-ar' : 'data-en');
      if (txt) el.textContent = txt;
    });

    // Update glitch pseudo-content by refreshing data-en
    const glitchEl = document.querySelector('.glitch');
    if (glitchEl) {
      const txt = glitchEl.getAttribute(isAr ? 'data-ar' : 'data-en');
      if (txt) glitchEl.setAttribute('data-en', txt);
    }
  }
}
