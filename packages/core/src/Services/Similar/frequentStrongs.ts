/**
 * Function-word Strong's numbers that nearly every verse pair shares, so they carry no
 * "why" signal. CURATED by hand from well-known high-frequency Greek and Hebrew particles,
 * articles, prepositions, conjunctions, pronouns and "to be"; it is NOT derived from corpus
 * counts. Content words (for example H3068, the divine name) are deliberately absent.
 */
export const FREQUENT_STRONGS: ReadonlySet<string> = new Set([
  // Greek
  'G3588', // the
  'G2532', // and
  'G1161', // but / and
  'G1722', // in
  'G1063', // for
  'G846', // he / she / it
  'G3739', // who / which
  'G3754', // that / because
  'G1519', // into
  'G2249', // we
  'G4771', // you
  'G1473', // I
  'G3756', // not
  'G1510', // to be
  'G3361', // not (subjunctive)
  'G1537', // out of
  'G3767', // therefore
  'G2443', // in order that
  'G5100', // someone / a certain
  'G235', // but
  'G1487', // if
  'G2228', // or / than
  'G302', // (modal particle)
  'G3778', // this
  'G1565', // that one
  'G3956', // all
  'G3305', // yet / nevertheless
  'G1909', // upon
  'G575', // from
  'G1223', // through
  'G3326', // with / after
  'G4314', // toward
  'G4862', // with
  'G2596', // according to
  'G3844', // beside
  'G5228', // on behalf of
  'G3778', // this
  'G2504', // and I
  'G3165', // me
  'G4675', // your
  'G1700', // my
  'G5213', // to you
  // Hebrew
  'H853', // (object marker)
  'H834', // which
  'H3588', // that / for
  'H1961', // to be
  'H413', // to / toward
  'H5921', // upon
  'H3808', // not
  'H559', // to say
  'H1931', // he / that
  'H3605', // all
  'H518', // if
  'H1992', // they
  'H5973', // with
  'H1571', // also
  'H4480', // from
  'H408', // not (prohibition)
  'H854', // with
  'H389', // surely
  'H1992', // they
  'H589', // I
  'H859', // you
  'H2088', // this
  'H5704', // until
  'H3651', // so
]);
