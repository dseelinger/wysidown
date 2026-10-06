# wysidown-example

[![Build](https://img.shields.io/badge/build-passing-brightgreen.svg)](https://example.com/ci)
[![npm](https://img.shields.io/npm/v/example.svg?style=flat-square)](https://www.npmjs.com/package/example)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A small library that does one thing. It reads a `config.json` file and returns
the merged settings, with environment variables taking precedence.

## Install

```sh
npm install example
```

## Usage

```js
import { load } from "example";

const settings = await load({ path: "./config.json" });
console.log(settings.port);
```

## Options

| Option    | Type      | Default         | Description                    |
| --------- | --------- | --------------- | ------------------------------ |
| `path`    | `string`  | `"config.json"` | File to read.                  |
| `env`     | `boolean` | `true`          | Read `EXAMPLE_*` variables.    |
| `strict`  | `boolean` | `false`         | Throw on unknown keys.         |

## Contributing

1. Fork the repository.
2. Create a branch: `git checkout -b my-change`.
3. Run the tests: `npm test`.
4. Open a pull request.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

## License

MIT © Example Author
