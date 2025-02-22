# Nimiq Cashlink Generator

This is a node-js based tool for generating and managing Cashlinks in bulk. It supports generating, modifying, funding
and claiming Cashlinks as well as creating statistics on generated Cashlinks.

If you are instead searching for an easier to use, web-based tool for simply creating and funding Cashlinks in bulk,
https://github.com/Albermonte/Nimiq-Multi-Cashlink might be interesting for you. However, this tool here provides more
features like creation of QR codes and managing links after their creation, and is more reliable for creating a large
number of Cashlinks.

## Setup

1. Install dependencies:
```bash
pnpm install
```

2. Generate secrets:
Cashlinks are derived from a master secret, such that they can potentially be re-created from that secret.
To generate a master secret, run
```bash
pnpm run secret
```

3. Configure environment:
Edit `.env` with your settings:
- `NODE_IP`: Your Nimiq node IP (default: 127.0.0.1)
- `NODE_PORT`: RPC port (default: 8648)
- `NETWORK`: Choose 'main' or 'test' network
- `TOKEN_LENGTH`: Length of cashlink tokens
- `SALT`: Base64 encoded salt for cashlink generation created in step 2.

## Usage

This tool requires running a [Nimiq node](https://github.com/nimiq/core-rs-albatross), which can also be a local node.
For installation and configuration instructions of the Nimiq node, have a look at its readme.

For use with the cashlink generator, the node must be run with enabled `rpc-server` and `sync_mode="full"`. If you want
to use the statistics tool, additionally `index_history = true` must be enabled. Also note that the statistics tool
currently only works with the transaction history available to your node, i.e. only transactions that happened while the
node was running.

Wait for the node to establish network consensus.

Then to launch the cashlink generator:
```bash
pnpm start
```

The supported operations are explained in the following sections. To remove the blockchain data synced by the Nimiq node
after you're done using the cashlink generator, if you think that you won't need it anymore, see [Cleanup](#cleanup).

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
- After the statistics have been generated, you have the choice to export them to a text file as specified by the
  prompt.

Note that the statistics tool currently only works with the transaction history available to your node, i.e. only
transactions that happened while the node was running.

### Create Images

For (re)creating images for previously created Cashlinks. This way, you can create both image types for a Cashlink batch
or change the image type.

- Make changes to the configuration constants in `render-qr-codes.js` or `render-coins.js`, if desired, to modify
  properties like size or layout.
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

### Cleanup

When you're done using the cashlink generator, you can consider deleting the blockchain data synced by the Nimiq node,
if you think that you won't need it anymore. The path where it's stored can be found in the `[database]` section of the
node's config file. Make sure to only delete the `consensus` folder(s), and not, for example, keys imported into the
node.

## Additional Utilities

### Master Secret Creation

See section [Setup](#setup).

### Nimiq Style SVG QR Code Generation

Although not really related to the main functionality of this package, this project includes a tool for creating SVG QR
codes in Nimiq Style, same as they are generated for Cashlinks.
To launch this tool, run
```batch
pnpm run qr
```

## CSV Format

The tool exports and imports CSV files in the following format:
```
token,shortlink,image-file,cashlink-url,private-key-base64
```

Example:
```
abc123,https://nim.id/abc123,qr-abc123.svg,https://hub.nimiq.com/cashlink/#...,...
```

## Examples

1. **Create New Cashlinks**
   ```
   > pnpm start
   > [Enter] for new cashlinks
   > Number of cashlinks: 10
   > Value in NIM: 1
   > Message: Welcome to Nimiq!
   > Theme: christmas
   ```

2. **Modify Existing Cashlinks**
   ```
   > pnpm start
   > Enter path to CSV: ./generated-cashlinks/2024-01-25/cashlinks.csv
   > Operation: change-theme
   > New theme: birthday
   ```

3. **Generate Statistics**
   ```
   > pnpm start
   > Enter path to CSV: ./generated-cashlinks/2024-01-25/cashlinks.csv
   > Operation: statistics
   ```

4. **Generate QR Code**
   ```
   > pnpm run qr
   > QR Content: https://nimiq.com
   > Color (light-blue/indigo; default indigo): light-blue
   > Error Correction (L/M/Q/H; default M): H
   > Filename (default nimiq-com-light-blue-H):
   ```

   This will generate a QR code in the `generated-qr` directory with:
   - Nimiq's radial gradient style
   - Light blue color scheme
   - High error correction level
   - SVG format output

## Requirements

- Node.js 16+
- Running Nimiq node
- Network access to Nimiq node

## Security Notes

- Keep your `.env` file secure
- Back up generated CSV files safely
- Never share private keys
- Use this tool at your own risk

## Tips and Tricks

### Modifying rendering parameters

The QR-Code renderer in `render-qr-codes.js` and the Coin renderer in `render-coins.js` provide multiple parameters
which can be adapted to modify the rendering result. This includes sizes, colors, layout etc.

### Converting images in post-processing

This tool generates images as SVGs. One possible tool to convert them to other formats is Inkscape. Images can for
example be converted to PDFs via the following:
```bash
find . -iname '*.svg' -execdir inkscape --export-type=pdf '{}' +
```
To combine all such PDFs into a merged PDF on a per-folder basis for example
[ghostscript can be used](https://stackoverflow.com/a/19358402):
```bash
find . -iname '*.pdf' -execdir ghostscript -dBATCH -dNOPAUSE -q -sDEVICE=pdfwrite -dPDFSETTINGS=/prepress -sOutputFile=merged.pdf '{}' +
```
Tip: combining individual QR codes generated by the QR code renderer into a merged pdf also easily allows to print
multiple codes on a single sheet of paper via the print settings, for example by printing 16 pages per sheet.
