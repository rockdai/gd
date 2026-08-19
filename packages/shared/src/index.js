'use strict';

// Intentionally a thin barrel: re-exports only the most-commonly-shared utilities.
// All cross-package consumers use sub-paths like require('@gd/shared/src/swas-firewall'),
// which is the canonical entry style (1:1 with the old require('../../lib/...') form,
// preserves diff legibility, and avoids accidentally exposing aliyun SDK clients
// or the rule-config loader at the package root). Add new exports here only if the
// shorter @gd/shared form starts being broadly useful — keeping this minimal is
// the deliberate design choice (spec §5.2).
module.exports = {
  ...require('./firewall-rule'),
  ...require('./ip'),
};
