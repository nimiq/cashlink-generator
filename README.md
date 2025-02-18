# Nimiq Cashlink Generator Tool

> This tool is a modernized fork of [nimiq/cashlink-generator](https://github.com/nimiq/cashlink-generator) originally created by [@danimoh](https://github.com/danimoh). 
> 
> **Improvements:**
> - Complete TypeScript rewrite with enhanced type safety
> - Modern environment configuration handling
> - Updated dependencies for latest Node.js compatibility
> - Nimiq 2.0 (Albatross PoS) support
> - Improved development experience with proper typing
> - Enhanced QR code generation capabilities

A tool for creating, managing, and handling Nimiq cashlinks. This tool allows you to create, fund, claim, and modify cashlinks in bulk.

## Setup

1. Install dependencies:
```bash
pnpm install
```

2. Generate secrets:
- Run the secret generation script:
```bash
pnpm run secret
```

3. Configure environment:
   - Edit `.env` with your settings:
     - `NODE_IP`: Your Nimiq node IP (default: 127.0.0.1)
     - `NODE_PORT`: RPC port (default: 8648)
     - `NETWORK`: Choose 'main' or 'test' network
     - `TOKEN_LENGTH`: Length of cashlink tokens
     - `SALT`: Base64 encoded salt for cashlink generation


## Usage

Run the tool:
```bash
pnpm start
```

### Features

1. **Create New Cashlinks**
   - Specify quantity
   - Set value in NIM
   - Add custom message
   - Choose theme (STANDARD, CHRISTMAS, LUNAR_NEW_YEAR, etc.)
   - Optional short link generation

2. **Load Existing Cashlinks**
   - Import from CSV file
   - Modify existing cashlinks
   - Generate new QR codes or coin images

3. **Available Operations**
   - `create-images`: Generate QR codes or coin images
   - `change-message`: Update message for all cashlinks
   - `change-theme`: Change theme of all cashlinks
   - `fund`: Fund cashlinks from a wallet
   - `claim`: Claim unclaimed cashlinks to an address
   - `statistics`: Generate usage statistics

4. **QR Code Generation**
   - Generate Nimiq-styled QR codes
   - Choose between light-blue or indigo color schemes
   - Set custom error correction levels
   - Output as SVG files in generated-qr directory

### CSV Format

The tool uses CSV files with the following format:
```
token,shortlink,image-file,cashlink-url,private-key-base64
```

Example:
```
abc123,,qr-abc123.svg,https://hub.nimiq.com/cashlink/#...,...
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
   > New theme: lunar_new_year
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
- Test with small amounts first
