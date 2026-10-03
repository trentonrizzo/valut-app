/* global window */
/* eslint-disable @typescript-eslint/no-unused-vars */
(function (scope) {
  'use strict'

  if (typeof scope.globalThis === 'undefined') {
    try {
      Object.defineProperty(scope, 'globalThis', {
        configurable: true,
        enumerable: false,
        writable: true,
        value: scope,
      })
    } catch (_error) {
      scope.globalThis = scope
    }
  }

  if (typeof Object.fromEntries !== 'function') {
    Object.fromEntries = function (entries) {
      var result = {}
      var iteratorMethod = typeof Symbol !== 'undefined' && Symbol.iterator && entries[Symbol.iterator]

      if (typeof iteratorMethod === 'function') {
        var iterator = iteratorMethod.call(entries)
        var step
        while (!(step = iterator.next()).done) {
          result[step.value[0]] = step.value[1]
        }
        return result
      }

      for (var index = 0; index < entries.length; index += 1) {
        result[entries[index][0]] = entries[index][1]
      }
      return result
    }
  }

  var webCrypto = scope.crypto || scope.msCrypto
  if (webCrypto && typeof webCrypto.randomUUID !== 'function') {
    var secureRandomUUID = function () {
      if (typeof webCrypto.getRandomValues !== 'function') {
        throw new Error('Secure random values are unavailable in this browser.')
      }

      var bytes = new Uint8Array(16)
      webCrypto.getRandomValues(bytes)
      bytes[6] = (bytes[6] & 15) | 64
      bytes[8] = (bytes[8] & 63) | 128

      var hex = []
      for (var index = 0; index < bytes.length; index += 1) {
        hex.push((bytes[index] + 256).toString(16).slice(1))
      }
      return (
        hex.slice(0, 4).join('') +
        '-' +
        hex.slice(4, 6).join('') +
        '-' +
        hex.slice(6, 8).join('') +
        '-' +
        hex.slice(8, 10).join('') +
        '-' +
        hex.slice(10, 16).join('')
      )
    }

    try {
      Object.defineProperty(webCrypto, 'randomUUID', {
        configurable: true,
        enumerable: false,
        writable: true,
        value: secureRandomUUID,
      })
    } catch (_error) {
      webCrypto.randomUUID = secureRandomUUID
    }
  }

  var showStartupFailure = function () {
    var root = scope.document && scope.document.getElementById('root')
    if (!root || root.firstChild) return
    root.setAttribute('role', 'alert')
    root.style.padding = '24px'
    root.style.color = '#ffffff'
    root.style.fontFamily = '-apple-system, BlinkMacSystemFont, sans-serif'
    root.textContent = 'Vault could not start on this browser. Reload the page to try again.'
  }

  if (typeof scope.addEventListener === 'function') {
    scope.addEventListener('error', function () {
      scope.setTimeout(showStartupFailure, 0)
    })
    scope.addEventListener('unhandledrejection', function () {
      scope.setTimeout(showStartupFailure, 0)
    })
  }
  scope.setTimeout(showStartupFailure, 15000)
})(window)
