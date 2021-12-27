# Cashlink Generator

This is a node-js based tool for generating and managing Cashlinks in bulk. It supports generating, modifying, funding
and claiming Cashlinks as well as creating statistics on generated Cashlinks. If you are instead searching for an easier
to use, web-based tool for simply creating and funding Cashlinks in bulk,
https://github.com/Albermonte/Nimiq-Multi-Cashlink might be interesting for you. However, for creating a large number of
Cashlinks (>10 for free funding transactions or >500 for paid funding transactions), this tool is more reliable as it
observes mempool limits.

## Installation of Dependencies

This tool depends on [@nimiq/core](https://github.com/nimiq/core-js) and therefore has the same build dependencies.
Follow steps 1. to 3. in [@nimiq/core's quickstart guide](https://github.com/nimiq/core-js#quickstart).

Then run `yarn` in the project folder to install the dependencies.

Additionally, using the cashlink generator requires a local Nimiq node running in the background. To install the Nimiq
client either follow the remaining steps of @nimiq/core's quickstart guide or
[install a prebuilt binary package](https://www.nimiq.com/developers/downloads/).

## Starting the Nimiq Node

If you manually installed the Nimiq client via the quickstart guide, download the
[sample config file](https://github.com/nimiq/core-js/blob/master/clients/nodejs/sample.conf). If you installed a
prebuilt package, locate the configuration file as described
[here in the "Configuration" section](https://www.nimiq.com/developers/downloads/).

Make the following changes to the config file:
- Enable the `rpcServer`.
- If you do not intend to run your Nimiq node continuously, but only for this Cashlink generator, you can change the
  `protocol` to `dumb`.
- Change the node `type` to `light` or `nano`. A light node will take a few minutes to sync but will be able to send out
  transactions faster and potentially more reliably. A nano node will sync within seconds but will be slower to send
  transactions, as it has to request Cashlink balances and Mempool updates from other nodes.
- If you do not want any blockchain state to be stored on your hard drive but instead to only be held in memory, you can
  enable the `volatile` setting. By enabling this, you will however always have to sync from scratch when you start your
  node.

Then, to start the Nimiq node if you installed the client manually, run
```bash
clients/nodejs/nimiq --config=<path/to/config-file>
```
If you installed a prebuilt package, start the client as described
[here in the "Usage" section](https://www.nimiq.com/developers/downloads/).

## Generating a Master Secret

Cashlinks are derived from a master secret, such that they can potentially be re-created from that secret.
To generate a master secret, run
```batch
node create-secret.js
```

## Usage

Launch the Cashlink generator via
```bash
node index.js
```

### Cashlink Creation

For creating and funding new Cashlinks.

- Choose to generate new Cashlinks by not specifying a path to a previously generated Cashlink `.csv` file.
- Specify how many Cashlinks to generate.
- Specify the value in NIM per Cashlink.
- Specify a custom message or use the default.
- Specify a theme by name or number or leave empty to not specify a theme.
- Specify a short link base URL, if you plan to create mappings on your server of short URLs based on a domain owned by
  you to the actual Cashlinks. The short URLs are generated as `<base url><6 digit random base64 cashlink token>`. To
  avoid your Cashlinks getting claimed in bulk via brute forcing, your server should have some form of rate limiting in
  place. The default short link base URL is "https://nim.id/", which is a Nimiq owned domain. You can specify "none" to
  opt out of short link creation. If short links are generated, these are the content of generated QR codes, otherwise
  they contain full Cashlinks.
- Choose whether Cashlinks should be rendered as individual QR code images or printable pages of hexagon coins.
- Cashlinks and images should now have been exported. Check the exported files before continuing with funding the
  created Cashlinks.
- Continue with funding as described in the next section starting at step 3.

### Cashlink Funding

For funding previously created, but not yet funded Cashlinks.

- Load a previously generated Cashlink `.csv` file by specifying its file path.
- Choose `fund` as operation.
- Choose whether you want to send funding transactions as `free` or `paid` transactions. Sending `free` transactions
  will take longer, as they are restricted to 10 transactions being pending in parallel, while `paid` transactions allow
  for up to 500 parallel pending transactions.
- Import a wallet via its backup words. Pasting is supported. Words can be separated by spaces or newlines and numbers
  between words are automatically stripped to allow for direct pasting from the Nimiq Keyguard. The words are not
  printed on screen to avoid them being visible in your history.
- Using a separate wallet per batch of Cashlinks might be a good idea to keep funds and transaction histories separate.
  It's also suggested creating new wallets for Cashlink creations instead of using your regular wallets, as funding
  Cashlinks will result in many entries being added to your transaction history.
- Confirm the Cashlink funding if you want to proceed.
- The Cashlinks will now be funded which might take some time.
- After the process finishes, transactions might still be pending in your local node and waiting to be relayed to other
  network nodes. Make sure to check your wallet balance and keep your node running if needed.

### Cashlink Claiming

For (re)claiming Cashlinks that are still unclaimed.

- Load a previously generated Cashlink `.csv` file by specifying its file path.
- Choose `claim` as operation.
- Specify where you want to send unclaimed funds to. It's advised to not use your regular Wallet for this, as claiming
  the Cashlinks will result in many entries being added to your transaction history. Instead, claim the Cashlinks to a
  temporary wallet and forward them from there.
- Confirm the Cashlink claiming if you want to proceed.
- Cashlink claiming transactions will always be sent as free transactions, as free claiming transactions from different
  senders (Cashlinks) are not as restricted as free funding transactions from the same wallet. Still, this operation
  will take some time.
- After the process finishes, transactions might still be pending in your local node and waiting to be relayed to other
  network nodes. Make sure to check your wallet balance and keep your node running if needed.

### Create Statistics

For creating statistics on previously created Cashlinks.

- Load a previously generated Cashlink `.csv` file by specifying its file path.
- Choose `statistics` as operation.
- Optionally specify an address that should be considered as the address where funds have been reclaimed to (see
  previous section).
- Specify an IANA timezone for the claims-per-day statistic. E.g. "UTC", "Europe/Berlin", "America/Costa_Rica".
- Generating the statistics will take some time.
- After the statistics have been generated, you have the choice to export them to a text file as specified by the
  prompt.

### Create Images

For (re)creating images for previously created Cashlinks. This way, you can create both image types for a Cashlink batch
or change the image type.

- Load a previously generated Cashlink `.csv` file by specifying its file path.
- Choose `create-images` as operation.
- Choose whether Cashlinks should be rendered as individual QR code images or printable pages of hexagon coins.
- If you changed the image format, the Cashlink `.csv` file will be re-exported.

### Change Message

For changing the encoded message of previously created Cashlinks.

- Load a previously generated Cashlink `.csv` file by specifying its file path.
- Choose `change-message` as operation.
- Specify a new message.
- If you changed the message, the Cashlink `.csv` file will be re-exported.

### Change Theme

For changing the encoded theme of previously created Cashlinks.

- Load a previously generated Cashlink `.csv` file by specifying its file path.
- Choose `change-theme` as operation.
- Specify a new theme by name or number.
- If you changed the theme, the Cashlink `.csv` file will be re-exported.

## Additional Utilities

### Master Secret Creation

See section [Generating a Master Secret](#generating-a-master-secret).

### Nimiq Style SVG QR Code Generation

Although not really related to the main functionality of this package, this project includes a tool for creating SVG QR
codes in Nimiq Style, same as they are generated for Cashlinks.
To launch this tool, run
```batch
node render-qr-codes.js
```
