/**
 * 随安装包内置的已签名市场索引（生产快照，sequence 2）。
 * 字节与签名来自发布端 `v1/index.json`/`v1/index.json.sig` 原文：客户端只用
 * marketPublicKeys() 的生产公钥验签，不回退上游 enso 快照。重新生成时必须保留
 * 原始字节（不要重排 JSON），JSON.stringify 仅用于把原文安全嵌进字符串字面量。
 */
export const BUILTIN_MARKET: { index: string; signature: string } | null = {
  index:
    '{\n  "schemaVersion": 2,\n  "marketId": "collabra",\n  "sequence": 2,\n  "generatedAt": "2026-11-14T04:56:51.779Z",\n  "plugins": [\n    {\n      "id": "collabra.paper",\n      "name": "Collabra Paper",\n      "description": "A warm neutral light and dark palette. Palette only: no scripts, network access, decoration or artwork.",\n      "tier": "official",\n      "category": "themes",\n      "tags": [\n        "theme",\n        "light",\n        "dark",\n        "neutral"\n      ],\n      "license": "MIT",\n      "homepage": "https://github.com/tingyuxuan123/collabra-plugins",\n      "versions": [\n        {\n          "version": "1.0.0",\n          "permissions": [],\n          "path": "packages/collabra.paper/1.0.0.zip",\n          "sha256": "830976b5b9c3426512e11d744228eab458afa8e65058d58efbd5fc3cc955d836",\n          "size": 4035,\n          "compatibility": {\n            "host": "collabra",\n            "apiVersion": 1,\n            "minAppVersion": "0.2.80",\n            "platforms": [\n              "darwin",\n              "win32",\n              "linux"\n            ],\n            "testedSurfaces": []\n          }\n        }\n      ],\n      "readme": {\n        "path": "readmes/collabra.paper/1.0.0.md",\n        "sha256": "f4ee18f95496ba505e392d2ab7efac8f2223bdf15f92cef5c8b49fc66fce1568",\n        "size": 1647\n      }\n    }\n  ]\n}\n',
  signature:
    '0/ze5UfBCU/+a203vXT2CTizWDSnK/Am2WCtvtT+qMjo7uJSOj9BCegUN/RP+rZAiIDFmX4tcZE3X344H143Bg==',
};
