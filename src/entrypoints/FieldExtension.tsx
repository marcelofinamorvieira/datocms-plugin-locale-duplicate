import { RenderFieldExtensionCtx } from "datocms-plugin-sdk";
import { Canvas, Button } from "datocms-react-ui";

interface FieldExtensionProps {
  ctx: RenderFieldExtensionCtx;
}

function removeBlockItemIds(value: unknown): unknown {
  // If it's not an object or is null, return as is
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  // If it's an array, process each element
  if (Array.isArray(value)) {
    return value.map(item => removeBlockItemIds(item));
  }

  // If it's an object, create a new object without 'id' keys
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (key !== 'id') {
      result[key] = removeBlockItemIds(val);
    }
  }
  return result;
}

export default function FieldExtension({ ctx }: FieldExtensionProps) {
  const availableLocales = ctx.formValues.internalLocales;

  if(!(Array.isArray(availableLocales) && availableLocales.length > 1)) {
    return <></>
  }

  const mainLocale = availableLocales[0];
  const isAtMainLocale = mainLocale == ctx.locale;

  const copyToAllLocales = async () => {
    const mainLocaleValue = (ctx.formValues[ctx.field.attributes.api_key] as Record<string, unknown>)[mainLocale];

    for (const locale of availableLocales.splice(1)) {
     
      await ctx.setFieldValue(ctx.field.attributes.api_key + `.${locale}`, removeBlockItemIds(mainLocaleValue));
    }
    ctx.notice("Value copied to all locales")
  };

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