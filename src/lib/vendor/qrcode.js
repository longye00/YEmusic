// @ts-nocheck
/*
 * QR Code 编码器（仅用于显示网易云扫码登录二维码）
 *
 * QRCode for JavaScript — Copyright (c) 2009 Kazuhiko Arase, http://www.d-project.com/
 * Licensed under the MIT license: http://www.opensource.org/licenses/mit-license.php
 * Node 版改写来自 qrcode-terminal 0.12.0（Apache-2.0，https://github.com/gtanner/qrcode-terminal）。
 * The word "QR Code" is registered trademark of DENSO WAVE INCORPORATED.
 *
 * 本文件由 esbuild 打包为单个 ES 模块，未改动算法。
 */
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// ../../../vercel/runtimes/node24/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode/QRMode.js
var require_QRMode = __commonJS({
  "../../../vercel/runtimes/node24/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode/QRMode.js"(exports, module) {
    module.exports = {
      MODE_NUMBER: 1,
      MODE_ALPHA_NUM: 2,
      MODE_8BIT_BYTE: 4,
      MODE_KANJI: 8
    };
  }
});

// ../../../vercel/runtimes/node24/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode/QR8bitByte.js
var require_QR8bitByte = __commonJS({
  "../../../vercel/runtimes/node24/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode/QR8bitByte.js"(exports, module) {
    var QRMode = require_QRMode();
    function QR8bitByte(data) {
      this.mode = QRMode.MODE_8BIT_BYTE, this.data = data;
    }
    QR8bitByte.prototype = {
      getLength: function() {
        return this.data.length;
      },
      write: function(buffer) {
        for (var i = 0; i < this.data.length; i++)
          buffer.put(this.data.charCodeAt(i), 8);
      }
    };
    module.exports = QR8bitByte;
  }
});

// ../../../vercel/runtimes/node24/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode/QRMath.js
var require_QRMath = __commonJS({
  "../../../vercel/runtimes/node24/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode/QRMath.js"(exports, module) {
    var QRMath = {
      glog: function(n) {
        if (n < 1)
          throw new Error("glog(" + n + ")");
        return QRMath.LOG_TABLE[n];
      },
      gexp: function(n) {
        for (; n < 0; )
          n += 255;
        for (; n >= 256; )
          n -= 255;
        return QRMath.EXP_TABLE[n];
      },
      EXP_TABLE: new Array(256),
      LOG_TABLE: new Array(256)
    };
    for (i = 0; i < 8; i++)
      QRMath.EXP_TABLE[i] = 1 << i;
    var i;
    for (i = 8; i < 256; i++)
      QRMath.EXP_TABLE[i] = QRMath.EXP_TABLE[i - 4] ^ QRMath.EXP_TABLE[i - 5] ^ QRMath.EXP_TABLE[i - 6] ^ QRMath.EXP_TABLE[i - 8];
    var i;
    for (i = 0; i < 255; i++)
      QRMath.LOG_TABLE[QRMath.EXP_TABLE[i]] = i;
    var i;
    module.exports = QRMath;
  }
});

// ../../../vercel/runtimes/node24/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode/QRPolynomial.js
var require_QRPolynomial = __commonJS({
  "../../../vercel/runtimes/node24/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode/QRPolynomial.js"(exports, module) {
    var QRMath = require_QRMath();
    function QRPolynomial(num, shift) {
      if (num.length === void 0)
        throw new Error(num.length + "/" + shift);
      for (var offset = 0; offset < num.length && num[offset] === 0; )
        offset++;
      this.num = new Array(num.length - offset + shift);
      for (var i = 0; i < num.length - offset; i++)
        this.num[i] = num[i + offset];
    }
    QRPolynomial.prototype = {
      get: function(index) {
        return this.num[index];
      },
      getLength: function() {
        return this.num.length;
      },
      multiply: function(e) {
        for (var num = new Array(this.getLength() + e.getLength() - 1), i = 0; i < this.getLength(); i++)
          for (var j = 0; j < e.getLength(); j++)
            num[i + j] ^= QRMath.gexp(QRMath.glog(this.get(i)) + QRMath.glog(e.get(j)));
        return new QRPolynomial(num, 0);
      },
      mod: function(e) {
        if (this.getLength() - e.getLength() < 0)
          return this;
        for (var ratio = QRMath.glog(this.get(0)) - QRMath.glog(e.get(0)), num = new Array(this.getLength()), i = 0; i < this.getLength(); i++)
          num[i] = this.get(i);
        for (var x = 0; x < e.getLength(); x++)
          num[x] ^= QRMath.gexp(QRMath.glog(e.get(x)) + ratio);
        return new QRPolynomial(num, 0).mod(e);
      }
    };
    module.exports = QRPolynomial;
  }
});

// ../../../vercel/runtimes/node24/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode/QRMaskPattern.js
var require_QRMaskPattern = __commonJS({
  "../../../vercel/runtimes/node24/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode/QRMaskPattern.js"(exports, module) {
    module.exports = {
      PATTERN000: 0,
      PATTERN001: 1,
      PATTERN010: 2,
      PATTERN011: 3,
      PATTERN100: 4,
      PATTERN101: 5,
      PATTERN110: 6,
      PATTERN111: 7
    };
  }
});

// ../../../vercel/runtimes/node24/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode/QRUtil.js
var require_QRUtil = __commonJS({
  "../../../vercel/runtimes/node24/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode/QRUtil.js"(exports, module) {
    var QRMode = require_QRMode(), QRPolynomial = require_QRPolynomial(), QRMath = require_QRMath(), QRMaskPattern = require_QRMaskPattern(), QRUtil = {
      PATTERN_POSITION_TABLE: [
        [],
        [6, 18],
        [6, 22],
        [6, 26],
        [6, 30],
        [6, 34],
        [6, 22, 38],
        [6, 24, 42],
        [6, 26, 46],
        [6, 28, 50],
        [6, 30, 54],
        [6, 32, 58],
        [6, 34, 62],
        [6, 26, 46, 66],
        [6, 26, 48, 70],
        [6, 26, 50, 74],
        [6, 30, 54, 78],
        [6, 30, 56, 82],
        [6, 30, 58, 86],
        [6, 34, 62, 90],
        [6, 28, 50, 72, 94],
        [6, 26, 50, 74, 98],
        [6, 30, 54, 78, 102],
        [6, 28, 54, 80, 106],
        [6, 32, 58, 84, 110],
        [6, 30, 58, 86, 114],
        [6, 34, 62, 90, 118],
        [6, 26, 50, 74, 98, 122],
        [6, 30, 54, 78, 102, 126],
        [6, 26, 52, 78, 104, 130],
        [6, 30, 56, 82, 108, 134],
        [6, 34, 60, 86, 112, 138],
        [6, 30, 58, 86, 114, 142],
        [6, 34, 62, 90, 118, 146],
        [6, 30, 54, 78, 102, 126, 150],
        [6, 24, 50, 76, 102, 128, 154],
        [6, 28, 54, 80, 106, 132, 158],
        [6, 32, 58, 84, 110, 136, 162],
        [6, 26, 54, 82, 110, 138, 166],
        [6, 30, 58, 86, 114, 142, 170]
      ],
      G15: 1335,
      G18: 7973,
      G15_MASK: 21522,
      getBCHTypeInfo: function(data) {
        for (var d = data << 10; QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15) >= 0; )
          d ^= QRUtil.G15 << QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15);
        return (data << 10 | d) ^ QRUtil.G15_MASK;
      },
      getBCHTypeNumber: function(data) {
        for (var d = data << 12; QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18) >= 0; )
          d ^= QRUtil.G18 << QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18);
        return data << 12 | d;
      },
      getBCHDigit: function(data) {
        for (var digit = 0; data !== 0; )
          digit++, data >>>= 1;
        return digit;
      },
      getPatternPosition: function(typeNumber) {
        return QRUtil.PATTERN_POSITION_TABLE[typeNumber - 1];
      },
      getMask: function(maskPattern, i, j) {
        switch (maskPattern) {
          case QRMaskPattern.PATTERN000:
            return (i + j) % 2 === 0;
          case QRMaskPattern.PATTERN001:
            return i % 2 === 0;
          case QRMaskPattern.PATTERN010:
            return j % 3 === 0;
          case QRMaskPattern.PATTERN011:
            return (i + j) % 3 === 0;
          case QRMaskPattern.PATTERN100:
            return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
          case QRMaskPattern.PATTERN101:
            return i * j % 2 + i * j % 3 === 0;
          case QRMaskPattern.PATTERN110:
            return (i * j % 2 + i * j % 3) % 2 === 0;
          case QRMaskPattern.PATTERN111:
            return (i * j % 3 + (i + j) % 2) % 2 === 0;
          default:
            throw new Error("bad maskPattern:" + maskPattern);
        }
      },
      getErrorCorrectPolynomial: function(errorCorrectLength) {
        for (var a = new QRPolynomial([1], 0), i = 0; i < errorCorrectLength; i++)
          a = a.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0));
        return a;
      },
      getLengthInBits: function(mode, type) {
        if (1 <= type && type < 10)
          switch (mode) {
            case QRMode.MODE_NUMBER:
              return 10;
            case QRMode.MODE_ALPHA_NUM:
              return 9;
            case QRMode.MODE_8BIT_BYTE:
              return 8;
            case QRMode.MODE_KANJI:
              return 8;
            default:
              throw new Error("mode:" + mode);
          }
        else if (type < 27)
          switch (mode) {
            case QRMode.MODE_NUMBER:
              return 12;
            case QRMode.MODE_ALPHA_NUM:
              return 11;
            case QRMode.MODE_8BIT_BYTE:
              return 16;
            case QRMode.MODE_KANJI:
              return 10;
            default:
              throw new Error("mode:" + mode);
          }
        else if (type < 41)
          switch (mode) {
            case QRMode.MODE_NUMBER:
              return 14;
            case QRMode.MODE_ALPHA_NUM:
              return 13;
            case QRMode.MODE_8BIT_BYTE:
              return 16;
            case QRMode.MODE_KANJI:
              return 12;
            default:
              throw new Error("mode:" + mode);
          }
        else
          throw new Error("type:" + type);
      },
      getLostPoint: function(qrCode) {
        var moduleCount = qrCode.getModuleCount(), lostPoint = 0, row = 0, col = 0;
        for (row = 0; row < moduleCount; row++)
          for (col = 0; col < moduleCount; col++) {
            for (var sameCount = 0, dark = qrCode.isDark(row, col), r = -1; r <= 1; r++)
              if (!(row + r < 0 || moduleCount <= row + r))
                for (var c = -1; c <= 1; c++)
                  col + c < 0 || moduleCount <= col + c || r === 0 && c === 0 || dark === qrCode.isDark(row + r, col + c) && sameCount++;
            sameCount > 5 && (lostPoint += 3 + sameCount - 5);
          }
        for (row = 0; row < moduleCount - 1; row++)
          for (col = 0; col < moduleCount - 1; col++) {
            var count = 0;
            qrCode.isDark(row, col) && count++, qrCode.isDark(row + 1, col) && count++, qrCode.isDark(row, col + 1) && count++, qrCode.isDark(row + 1, col + 1) && count++, (count === 0 || count === 4) && (lostPoint += 3);
          }
        for (row = 0; row < moduleCount; row++)
          for (col = 0; col < moduleCount - 6; col++)
            qrCode.isDark(row, col) && !qrCode.isDark(row, col + 1) && qrCode.isDark(row, col + 2) && qrCode.isDark(row, col + 3) && qrCode.isDark(row, col + 4) && !qrCode.isDark(row, col + 5) && qrCode.isDark(row, col + 6) && (lostPoint += 40);
        for (col = 0; col < moduleCount; col++)
          for (row = 0; row < moduleCount - 6; row++)
            qrCode.isDark(row, col) && !qrCode.isDark(row + 1, col) && qrCode.isDark(row + 2, col) && qrCode.isDark(row + 3, col) && qrCode.isDark(row + 4, col) && !qrCode.isDark(row + 5, col) && qrCode.isDark(row + 6, col) && (lostPoint += 40);
        var darkCount = 0;
        for (col = 0; col < moduleCount; col++)
          for (row = 0; row < moduleCount; row++)
            qrCode.isDark(row, col) && darkCount++;
        var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
        return lostPoint += ratio * 10, lostPoint;
      }
    };
    module.exports = QRUtil;
  }
});

// ../../../vercel/runtimes/node24/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js
var require_QRErrorCorrectLevel = __commonJS({
  "../../../vercel/runtimes/node24/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js"(exports, module) {
    module.exports = {
      L: 1,
      M: 0,
      Q: 3,
      H: 2
    };
  }
});

// ../../../vercel/runtimes/node24/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode/QRRSBlock.js
var require_QRRSBlock = __commonJS({
  "../../../vercel/runtimes/node24/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode/QRRSBlock.js"(exports, module) {
    var QRErrorCorrectLevel = require_QRErrorCorrectLevel();
    function QRRSBlock(totalCount, dataCount) {
      this.totalCount = totalCount, this.dataCount = dataCount;
    }
    QRRSBlock.RS_BLOCK_TABLE = [
      // L
      // M
      // Q
      // H
      // 1
      [1, 26, 19],
      [1, 26, 16],
      [1, 26, 13],
      [1, 26, 9],
      // 2
      [1, 44, 34],
      [1, 44, 28],
      [1, 44, 22],
      [1, 44, 16],
      // 3
      [1, 70, 55],
      [1, 70, 44],
      [2, 35, 17],
      [2, 35, 13],
      // 4		
      [1, 100, 80],
      [2, 50, 32],
      [2, 50, 24],
      [4, 25, 9],
      // 5
      [1, 134, 108],
      [2, 67, 43],
      [2, 33, 15, 2, 34, 16],
      [2, 33, 11, 2, 34, 12],
      // 6
      [2, 86, 68],
      [4, 43, 27],
      [4, 43, 19],
      [4, 43, 15],
      // 7		
      [2, 98, 78],
      [4, 49, 31],
      [2, 32, 14, 4, 33, 15],
      [4, 39, 13, 1, 40, 14],
      // 8
      [2, 121, 97],
      [2, 60, 38, 2, 61, 39],
      [4, 40, 18, 2, 41, 19],
      [4, 40, 14, 2, 41, 15],
      // 9
      [2, 146, 116],
      [3, 58, 36, 2, 59, 37],
      [4, 36, 16, 4, 37, 17],
      [4, 36, 12, 4, 37, 13],
      // 10		
      [2, 86, 68, 2, 87, 69],
      [4, 69, 43, 1, 70, 44],
      [6, 43, 19, 2, 44, 20],
      [6, 43, 15, 2, 44, 16],
      // 11
      [4, 101, 81],
      [1, 80, 50, 4, 81, 51],
      [4, 50, 22, 4, 51, 23],
      [3, 36, 12, 8, 37, 13],
      // 12
      [2, 116, 92, 2, 117, 93],
      [6, 58, 36, 2, 59, 37],
      [4, 46, 20, 6, 47, 21],
      [7, 42, 14, 4, 43, 15],
      // 13
      [4, 133, 107],
      [8, 59, 37, 1, 60, 38],
      [8, 44, 20, 4, 45, 21],
      [12, 33, 11, 4, 34, 12],
      // 14
      [3, 145, 115, 1, 146, 116],
      [4, 64, 40, 5, 65, 41],
      [11, 36, 16, 5, 37, 17],
      [11, 36, 12, 5, 37, 13],
      // 15
      [5, 109, 87, 1, 110, 88],
      [5, 65, 41, 5, 66, 42],
      [5, 54, 24, 7, 55, 25],
      [11, 36, 12],
      // 16
      [5, 122, 98, 1, 123, 99],
      [7, 73, 45, 3, 74, 46],
      [15, 43, 19, 2, 44, 20],
      [3, 45, 15, 13, 46, 16],
      // 17
      [1, 135, 107, 5, 136, 108],
      [10, 74, 46, 1, 75, 47],
      [1, 50, 22, 15, 51, 23],
      [2, 42, 14, 17, 43, 15],
      // 18
      [5, 150, 120, 1, 151, 121],
      [9, 69, 43, 4, 70, 44],
      [17, 50, 22, 1, 51, 23],
      [2, 42, 14, 19, 43, 15],
      // 19
      [3, 141, 113, 4, 142, 114],
      [3, 70, 44, 11, 71, 45],
      [17, 47, 21, 4, 48, 22],
      [9, 39, 13, 16, 40, 14],
      // 20
      [3, 135, 107, 5, 136, 108],
      [3, 67, 41, 13, 68, 42],
      [15, 54, 24, 5, 55, 25],
      [15, 43, 15, 10, 44, 16],
      // 21
      [4, 144, 116, 4, 145, 117],
      [17, 68, 42],
      [17, 50, 22, 6, 51, 23],
      [19, 46, 16, 6, 47, 17],
      // 22
      [2, 139, 111, 7, 140, 112],
      [17, 74, 46],
      [7, 54, 24, 16, 55, 25],
      [34, 37, 13],
      // 23
      [4, 151, 121, 5, 152, 122],
      [4, 75, 47, 14, 76, 48],
      [11, 54, 24, 14, 55, 25],
      [16, 45, 15, 14, 46, 16],
      // 24
      [6, 147, 117, 4, 148, 118],
      [6, 73, 45, 14, 74, 46],
      [11, 54, 24, 16, 55, 25],
      [30, 46, 16, 2, 47, 17],
      // 25
      [8, 132, 106, 4, 133, 107],
      [8, 75, 47, 13, 76, 48],
      [7, 54, 24, 22, 55, 25],
      [22, 45, 15, 13, 46, 16],
      // 26
      [10, 142, 114, 2, 143, 115],
      [19, 74, 46, 4, 75, 47],
      [28, 50, 22, 6, 51, 23],
      [33, 46, 16, 4, 47, 17],
      // 27
      [8, 152, 122, 4, 153, 123],
      [22, 73, 45, 3, 74, 46],
      [8, 53, 23, 26, 54, 24],
      [12, 45, 15, 28, 46, 16],
      // 28
      [3, 147, 117, 10, 148, 118],
      [3, 73, 45, 23, 74, 46],
      [4, 54, 24, 31, 55, 25],
      [11, 45, 15, 31, 46, 16],
      // 29
      [7, 146, 116, 7, 147, 117],
      [21, 73, 45, 7, 74, 46],
      [1, 53, 23, 37, 54, 24],
      [19, 45, 15, 26, 46, 16],
      // 30
      [5, 145, 115, 10, 146, 116],
      [19, 75, 47, 10, 76, 48],
      [15, 54, 24, 25, 55, 25],
      [23, 45, 15, 25, 46, 16],
      // 31
      [13, 145, 115, 3, 146, 116],
      [2, 74, 46, 29, 75, 47],
      [42, 54, 24, 1, 55, 25],
      [23, 45, 15, 28, 46, 16],
      // 32
      [17, 145, 115],
      [10, 74, 46, 23, 75, 47],
      [10, 54, 24, 35, 55, 25],
      [19, 45, 15, 35, 46, 16],
      // 33
      [17, 145, 115, 1, 146, 116],
      [14, 74, 46, 21, 75, 47],
      [29, 54, 24, 19, 55, 25],
      [11, 45, 15, 46, 46, 16],
      // 34
      [13, 145, 115, 6, 146, 116],
      [14, 74, 46, 23, 75, 47],
      [44, 54, 24, 7, 55, 25],
      [59, 46, 16, 1, 47, 17],
      // 35
      [12, 151, 121, 7, 152, 122],
      [12, 75, 47, 26, 76, 48],
      [39, 54, 24, 14, 55, 25],
      [22, 45, 15, 41, 46, 16],
      // 36
      [6, 151, 121, 14, 152, 122],
      [6, 75, 47, 34, 76, 48],
      [46, 54, 24, 10, 55, 25],
      [2, 45, 15, 64, 46, 16],
      // 37
      [17, 152, 122, 4, 153, 123],
      [29, 74, 46, 14, 75, 47],
      [49, 54, 24, 10, 55, 25],
      [24, 45, 15, 46, 46, 16],
      // 38
      [4, 152, 122, 18, 153, 123],
      [13, 74, 46, 32, 75, 47],
      [48, 54, 24, 14, 55, 25],
      [42, 45, 15, 32, 46, 16],
      // 39
      [20, 147, 117, 4, 148, 118],
      [40, 75, 47, 7, 76, 48],
      [43, 54, 24, 22, 55, 25],
      [10, 45, 15, 67, 46, 16],
      // 40
      [19, 148, 118, 6, 149, 119],
      [18, 75, 47, 31, 76, 48],
      [34, 54, 24, 34, 55, 25],
      [20, 45, 15, 61, 46, 16]
    ];
    QRRSBlock.getRSBlocks = function(typeNumber, errorCorrectLevel) {
      var rsBlock = QRRSBlock.getRsBlockTable(typeNumber, errorCorrectLevel);
      if (rsBlock === void 0)
        throw new Error("bad rs block @ typeNumber:" + typeNumber + "/errorCorrectLevel:" + errorCorrectLevel);
      for (var length = rsBlock.length / 3, list = [], i = 0; i < length; i++)
        for (var count = rsBlock[i * 3 + 0], totalCount = rsBlock[i * 3 + 1], dataCount = rsBlock[i * 3 + 2], j = 0; j < count; j++)
          list.push(new QRRSBlock(totalCount, dataCount));
      return list;
    };
    QRRSBlock.getRsBlockTable = function(typeNumber, errorCorrectLevel) {
      switch (errorCorrectLevel) {
        case QRErrorCorrectLevel.L:
          return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
        case QRErrorCorrectLevel.M:
          return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
        case QRErrorCorrectLevel.Q:
          return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
        case QRErrorCorrectLevel.H:
          return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
        default:
          return;
      }
    };
    module.exports = QRRSBlock;
  }
});

// ../../../vercel/runtimes/node24/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode/QRBitBuffer.js
var require_QRBitBuffer = __commonJS({
  "../../../vercel/runtimes/node24/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode/QRBitBuffer.js"(exports, module) {
    function QRBitBuffer() {
      this.buffer = [], this.length = 0;
    }
    QRBitBuffer.prototype = {
      get: function(index) {
        var bufIndex = Math.floor(index / 8);
        return (this.buffer[bufIndex] >>> 7 - index % 8 & 1) == 1;
      },
      put: function(num, length) {
        for (var i = 0; i < length; i++)
          this.putBit((num >>> length - i - 1 & 1) == 1);
      },
      getLengthInBits: function() {
        return this.length;
      },
      putBit: function(bit) {
        var bufIndex = Math.floor(this.length / 8);
        this.buffer.length <= bufIndex && this.buffer.push(0), bit && (this.buffer[bufIndex] |= 128 >>> this.length % 8), this.length++;
      }
    };
    module.exports = QRBitBuffer;
  }
});

// ../../../vercel/runtimes/node24/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode/index.js
var require_QRCode = __commonJS({
  "../../../vercel/runtimes/node24/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode/index.js"(exports, module) {
    var QR8bitByte = require_QR8bitByte(), QRUtil = require_QRUtil(), QRPolynomial = require_QRPolynomial(), QRRSBlock = require_QRRSBlock(), QRBitBuffer = require_QRBitBuffer();
    function QRCode(typeNumber, errorCorrectLevel) {
      this.typeNumber = typeNumber, this.errorCorrectLevel = errorCorrectLevel, this.modules = null, this.moduleCount = 0, this.dataCache = null, this.dataList = [];
    }
    QRCode.prototype = {
      addData: function(data) {
        var newData = new QR8bitByte(data);
        this.dataList.push(newData), this.dataCache = null;
      },
      isDark: function(row, col) {
        if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col)
          throw new Error(row + "," + col);
        return this.modules[row][col];
      },
      getModuleCount: function() {
        return this.moduleCount;
      },
      make: function() {
        if (this.typeNumber < 1) {
          var typeNumber = 1;
          for (typeNumber = 1; typeNumber < 40; typeNumber++) {
            for (var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, this.errorCorrectLevel), buffer = new QRBitBuffer(), totalDataCount = 0, i = 0; i < rsBlocks.length; i++)
              totalDataCount += rsBlocks[i].dataCount;
            for (var x = 0; x < this.dataList.length; x++) {
              var data = this.dataList[x];
              buffer.put(data.mode, 4), buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber)), data.write(buffer);
            }
            if (buffer.getLengthInBits() <= totalDataCount * 8)
              break;
          }
          this.typeNumber = typeNumber;
        }
        this.makeImpl(!1, this.getBestMaskPattern());
      },
      makeImpl: function(test, maskPattern) {
        this.moduleCount = this.typeNumber * 4 + 17, this.modules = new Array(this.moduleCount);
        for (var row = 0; row < this.moduleCount; row++) {
          this.modules[row] = new Array(this.moduleCount);
          for (var col = 0; col < this.moduleCount; col++)
            this.modules[row][col] = null;
        }
        this.setupPositionProbePattern(0, 0), this.setupPositionProbePattern(this.moduleCount - 7, 0), this.setupPositionProbePattern(0, this.moduleCount - 7), this.setupPositionAdjustPattern(), this.setupTimingPattern(), this.setupTypeInfo(test, maskPattern), this.typeNumber >= 7 && this.setupTypeNumber(test), this.dataCache === null && (this.dataCache = QRCode.createData(this.typeNumber, this.errorCorrectLevel, this.dataList)), this.mapData(this.dataCache, maskPattern);
      },
      setupPositionProbePattern: function(row, col) {
        for (var r = -1; r <= 7; r++)
          if (!(row + r <= -1 || this.moduleCount <= row + r))
            for (var c = -1; c <= 7; c++)
              col + c <= -1 || this.moduleCount <= col + c || (0 <= r && r <= 6 && (c === 0 || c === 6) || 0 <= c && c <= 6 && (r === 0 || r === 6) || 2 <= r && r <= 4 && 2 <= c && c <= 4 ? this.modules[row + r][col + c] = !0 : this.modules[row + r][col + c] = !1);
      },
      getBestMaskPattern: function() {
        for (var minLostPoint = 0, pattern = 0, i = 0; i < 8; i++) {
          this.makeImpl(!0, i);
          var lostPoint = QRUtil.getLostPoint(this);
          (i === 0 || minLostPoint > lostPoint) && (minLostPoint = lostPoint, pattern = i);
        }
        return pattern;
      },
      createMovieClip: function(target_mc, instance_name, depth) {
        var qr_mc = target_mc.createEmptyMovieClip(instance_name, depth), cs = 1;
        this.make();
        for (var row = 0; row < this.modules.length; row++)
          for (var y = row * cs, col = 0; col < this.modules[row].length; col++) {
            var x = col * cs, dark = this.modules[row][col];
            dark && (qr_mc.beginFill(0, 100), qr_mc.moveTo(x, y), qr_mc.lineTo(x + cs, y), qr_mc.lineTo(x + cs, y + cs), qr_mc.lineTo(x, y + cs), qr_mc.endFill());
          }
        return qr_mc;
      },
      setupTimingPattern: function() {
        for (var r = 8; r < this.moduleCount - 8; r++)
          this.modules[r][6] === null && (this.modules[r][6] = r % 2 === 0);
        for (var c = 8; c < this.moduleCount - 8; c++)
          this.modules[6][c] === null && (this.modules[6][c] = c % 2 === 0);
      },
      setupPositionAdjustPattern: function() {
        for (var pos = QRUtil.getPatternPosition(this.typeNumber), i = 0; i < pos.length; i++)
          for (var j = 0; j < pos.length; j++) {
            var row = pos[i], col = pos[j];
            if (this.modules[row][col] === null)
              for (var r = -2; r <= 2; r++)
                for (var c = -2; c <= 2; c++)
                  Math.abs(r) === 2 || Math.abs(c) === 2 || r === 0 && c === 0 ? this.modules[row + r][col + c] = !0 : this.modules[row + r][col + c] = !1;
          }
      },
      setupTypeNumber: function(test) {
        for (var bits = QRUtil.getBCHTypeNumber(this.typeNumber), mod, i = 0; i < 18; i++)
          mod = !test && (bits >> i & 1) === 1, this.modules[Math.floor(i / 3)][i % 3 + this.moduleCount - 8 - 3] = mod;
        for (var x = 0; x < 18; x++)
          mod = !test && (bits >> x & 1) === 1, this.modules[x % 3 + this.moduleCount - 8 - 3][Math.floor(x / 3)] = mod;
      },
      setupTypeInfo: function(test, maskPattern) {
        for (var data = this.errorCorrectLevel << 3 | maskPattern, bits = QRUtil.getBCHTypeInfo(data), mod, v = 0; v < 15; v++)
          mod = !test && (bits >> v & 1) === 1, v < 6 ? this.modules[v][8] = mod : v < 8 ? this.modules[v + 1][8] = mod : this.modules[this.moduleCount - 15 + v][8] = mod;
        for (var h = 0; h < 15; h++)
          mod = !test && (bits >> h & 1) === 1, h < 8 ? this.modules[8][this.moduleCount - h - 1] = mod : h < 9 ? this.modules[8][15 - h - 1 + 1] = mod : this.modules[8][15 - h - 1] = mod;
        this.modules[this.moduleCount - 8][8] = !test;
      },
      mapData: function(data, maskPattern) {
        for (var inc = -1, row = this.moduleCount - 1, bitIndex = 7, byteIndex = 0, col = this.moduleCount - 1; col > 0; col -= 2)
          for (col === 6 && col--; ; ) {
            for (var c = 0; c < 2; c++)
              if (this.modules[row][col - c] === null) {
                var dark = !1;
                byteIndex < data.length && (dark = (data[byteIndex] >>> bitIndex & 1) === 1);
                var mask = QRUtil.getMask(maskPattern, row, col - c);
                mask && (dark = !dark), this.modules[row][col - c] = dark, bitIndex--, bitIndex === -1 && (byteIndex++, bitIndex = 7);
              }
            if (row += inc, row < 0 || this.moduleCount <= row) {
              row -= inc, inc = -inc;
              break;
            }
          }
      }
    };
    QRCode.PAD0 = 236;
    QRCode.PAD1 = 17;
    QRCode.createData = function(typeNumber, errorCorrectLevel, dataList) {
      for (var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectLevel), buffer = new QRBitBuffer(), i = 0; i < dataList.length; i++) {
        var data = dataList[i];
        buffer.put(data.mode, 4), buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber)), data.write(buffer);
      }
      for (var totalDataCount = 0, x = 0; x < rsBlocks.length; x++)
        totalDataCount += rsBlocks[x].dataCount;
      if (buffer.getLengthInBits() > totalDataCount * 8)
        throw new Error("code length overflow. (" + buffer.getLengthInBits() + ">" + totalDataCount * 8 + ")");
      for (buffer.getLengthInBits() + 4 <= totalDataCount * 8 && buffer.put(0, 4); buffer.getLengthInBits() % 8 !== 0; )
        buffer.putBit(!1);
      for (; !(buffer.getLengthInBits() >= totalDataCount * 8 || (buffer.put(QRCode.PAD0, 8), buffer.getLengthInBits() >= totalDataCount * 8)); )
        buffer.put(QRCode.PAD1, 8);
      return QRCode.createBytes(buffer, rsBlocks);
    };
    QRCode.createBytes = function(buffer, rsBlocks) {
      for (var offset = 0, maxDcCount = 0, maxEcCount = 0, dcdata = new Array(rsBlocks.length), ecdata = new Array(rsBlocks.length), r = 0; r < rsBlocks.length; r++) {
        var dcCount = rsBlocks[r].dataCount, ecCount = rsBlocks[r].totalCount - dcCount;
        maxDcCount = Math.max(maxDcCount, dcCount), maxEcCount = Math.max(maxEcCount, ecCount), dcdata[r] = new Array(dcCount);
        for (var i = 0; i < dcdata[r].length; i++)
          dcdata[r][i] = 255 & buffer.buffer[i + offset];
        offset += dcCount;
        var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount), rawPoly = new QRPolynomial(dcdata[r], rsPoly.getLength() - 1), modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (var x = 0; x < ecdata[r].length; x++) {
          var modIndex = x + modPoly.getLength() - ecdata[r].length;
          ecdata[r][x] = modIndex >= 0 ? modPoly.get(modIndex) : 0;
        }
      }
      for (var totalCodeCount = 0, y = 0; y < rsBlocks.length; y++)
        totalCodeCount += rsBlocks[y].totalCount;
      for (var data = new Array(totalCodeCount), index = 0, z = 0; z < maxDcCount; z++)
        for (var s = 0; s < rsBlocks.length; s++)
          z < dcdata[s].length && (data[index++] = dcdata[s][z]);
      for (var xx = 0; xx < maxEcCount; xx++)
        for (var t = 0; t < rsBlocks.length; t++)
          xx < ecdata[t].length && (data[index++] = ecdata[t][xx]);
      return data;
    };
    module.exports = QRCode;
  }
});

// ../../../tmp/qr-entry.cjs
var require_qr_entry = __commonJS({
  "../../../tmp/qr-entry.cjs"(exports, module) {
    var QRCode = require_QRCode(), Level = require_QRErrorCorrectLevel();
    module.exports = function(text, level) {
      let qr = new QRCode(-1, Level[level || "M"]);
      return qr.addData(text), qr.make(), qr.modules.map((row) => row.map(Boolean));
    };
  }
});
export default require_qr_entry();
