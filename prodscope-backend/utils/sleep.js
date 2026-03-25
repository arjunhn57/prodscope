"use strict";

function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

module.exports = { sleep };
