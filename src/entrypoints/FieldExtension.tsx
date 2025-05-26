/**
 * Field extension component that adds copy buttons to configured fields
 * in the record editing interface.
 */
import { RenderFieldExtensionCtx } from "datocms-plugin-sdk";
import { Canvas, Button } from "datocms-react-ui";

/**
 * Props for the FieldExtension component
 */
interface FieldExtensionProps {
  ctx: RenderFieldExtensionCtx;
}

/**
 * Recursively removes 'id' fields from nested blocks and structured text.
 * This is necessary when copying content between locales to avoid
 * duplicate block IDs which would cause validation errors.
 */
function removeBlockItemIds(value: unknown): unknown {
  // Base case: primitive values or null
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  // Recursively process arrays
  if (Array.isArray(value)) {
    return value.map(item => removeBlockItemIds(item));
  }

  // For objects, create a new object excluding 'id' fields
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (key !== 'id') {
      result[key] = removeBlockItemIds(val);
    }
  }
  return result;
}

/**
 * Renders copy buttons for localized fields based on the current locale.
 * - Main locale: shows "Copy to all locales" button
 * - Other locales: shows "Copy from [main locale]" button
 */
export default function FieldExtension({ ctx }: FieldExtensionProps) {
  // Get available locales from the record
  const availableLocales = ctx.formValues.internalLocales;

  // Don't show copy buttons if there's only one locale
  if(!(Array.isArray(availableLocales) && availableLocales.length > 1)) {
    return <></>
  }

  // The first locale is considered the main/default locale
  const mainLocale = availableLocales[0];
  const isAtMainLocale = mainLocale == ctx.locale;

  /**
   * Copy field value from main locale to all other locales
   */
  const copyToAllLocales = async () => {
    const mainLocaleValue = (ctx.formValues[ctx.field.attributes.api_key] as Record<string, unknown>)[mainLocale];

    for (const locale of availableLocales.splice(1)) {
     
      await ctx.setFieldValue(ctx.field.attributes.api_key + `.${locale}`, removeBlockItemIds(mainLocaleValue));
    }
    ctx.notice("Value copied to all locales")
  };

  /**
   * Copy field value from main locale to current locale
   */
  const copyFromMainLocale = async () => {
    const mainLocaleValue = (ctx.formValues[ctx.field.attributes.api_key] as Record<string, unknown>)[mainLocale];
    await ctx.setFieldValue(ctx.field.attributes.api_key + `.${ctx.locale}`, removeBlockItemIds(mainLocaleValue));
    ctx.notice(`Value copied from ${mainLocale}`)
  };

  return (
    <Canvas ctx={ctx}>
      {isAtMainLocale && <Button onClick={copyToAllLocales} buttonType="muted" buttonSize="s">
        Copy to all locales
      </Button>}
      {!isAtMainLocale && <Button onClick={copyFromMainLocale} buttonType="muted" buttonSize="s">
        Copy from {mainLocale}
      </Button>}
    </Canvas>
  );
}