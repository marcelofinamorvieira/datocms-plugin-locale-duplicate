# Locale Duplicate

Duplicate the content of one DatoCMS locale into another. This can be useful when you need to:

- Migrate content from an old locale code to a new one (and optionally remove the old locale afterward).
- Duplicate content between two similar locales (e.g., `en-US` and `en-UK`) as a starting point before making minor adjustments.

## Features

- One-click duplication of all fields from a source locale to a target locale.
- Selective duplication of specific content models.
- Overwrites all fields in the target locale with the content from the source locale.
- Detailed operation console showing progress and record IDs.

## Configuration

No special configuration steps are required. Once installed, open the plugin and select:

1. **From** – the source locale containing content you want to copy.
2. **To** – the target locale that will receive the copied content.

## Usage

1. In the **Plugins** section of your DatoCMS project, open **Locale Duplicate**.
2. Choose the source locale (the locale that has the content you want to duplicate).
3. Choose the target locale (the locale that will receive the copied content).
4. Select which models you want to duplicate:
   - By default, all models are selected
   - Uncheck any models you don't want to include in the duplication process
   - This allows for targeted updates of specific content types
5. Click **Duplicate locale content**.
6. You will be prompted with two confirmation steps:
   - Confirm that you truly want to duplicate the content.
   - Confirm that you understand the existing target locale content will be overwritten.
7. Watch the progress in the Operation Console. Once finished, you'll see a summary of the duplication process with details on successful and failed records.

## Common Use Cases

### Renaming a Locale

1. Create a new locale in **Settings** → **Locales** (e.g., rename `en-OLD` to `en-NEW`).
2. In the **Locale Duplicate** plugin, choose `en-OLD` as the source and `en-NEW` as the target.
3. Duplicate the content.
4. Remove the old locale (`en-OLD`) from **Settings** → **Locales** if desired.

### Setting Up a Similar Locale

If you have a locale like `en-US` and want a similar locale like `en-UK`:

1. Create `en-UK` in **Settings** → **Locales**.
2. In the plugin, select `en-US` as the source and `en-UK` as the target.
3. Duplicate the content.

### Updating Specific Content Types

If you've made major updates to certain models in one locale and want to propagate only those changes:

1. Select your source and target locales.
2. Uncheck all models except the ones you specifically want to update.
3. Duplicate only the selected content models.
