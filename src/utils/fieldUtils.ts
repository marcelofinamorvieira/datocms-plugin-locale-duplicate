/**
 * Field utility functions for the Locale Duplicate plugin
 */

import { LocalizedField, isLocalizedField } from '../types';

/**
 * Checks if a field type is supported for locale duplication
 */
export function isFieldTypeSupported(fieldType: string): boolean {
  const supportedTypes = [
    'string',
    'text',
    'structured_text',
    'json',
    'seo',
    'slug'
  ];
  
  return supportedTypes.includes(fieldType);
}

/**
 * Gets the value of a field from a localized field object
 */
export function getFieldValue(
  field: LocalizedField | unknown,
  locale: string
): unknown {
  if (isLocalizedField(field)) {
    return field[locale];
  }
  return undefined;
}

/**
 * Sets the value of a field in a localized field object
 */
export function setFieldValue(
  field: LocalizedField | unknown,
  locale: string,
  value: unknown
): LocalizedField {
  if (!isLocalizedField(field)) {
    return { [locale]: value };
  }
  
  return {
    ...field,
    [locale]: value
  };
}


/**
 * Removes block item IDs - version for field extension (creates new objects)
 * This version creates new objects without ID fields, suitable for field-level copying
 */
export function removeBlockItemIdsImmutable(value: unknown): unknown {
  // Base case: primitive values or null
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  // Recursively process arrays
  if (Array.isArray(value)) {
    return value.map(item => removeBlockItemIdsImmutable(item));
  }

  // For objects, create a new object excluding 'id' fields
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (key !== 'id') {
      result[key] = removeBlockItemIdsImmutable(val);
    }
  }
  return result;
}

/**
 * Removes block item IDs - version for settings area (mutates objects)
 * This version mutates objects in place, suitable for bulk operations
 */
export function removeBlockItemIdsMutable(obj: unknown): unknown {
  // Handle array structures recursively
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      removeBlockItemIdsMutable(obj[i]);
    }
  } else if (obj && typeof obj === 'object') {
    // Process objects that might contain block or item structures
    const typedObj = obj as Record<string, unknown>;
    
    // Handle 'block' type objects which have nested 'item' objects with IDs
    if (
      typedObj.type === 'block' && 
      typedObj.item && 
      typeof typedObj.item === 'object' && 
      typedObj.item !== null
    ) {
      const itemObj = typedObj.item as { id?: unknown };
      if ('id' in itemObj) {
        // Remove the ID by setting to undefined rather than using delete operator
        itemObj.id = undefined;
      }
    }

    // Handle 'item' type objects which have direct IDs
    if (
      typedObj.type === 'item' && 
      'id' in typedObj
    ) {
      // Remove the ID by setting to undefined rather than using delete operator
      (typedObj as { id?: unknown }).id = undefined;
    }

    // Process all properties of the object recursively
    for (const key in typedObj) {
      removeBlockItemIdsMutable(typedObj[key]);
    }
  }
  return obj;
}

/**
 * Validates if a locale code is valid
 */
export function isValidLocale(locale: string): boolean {
  // Matches patterns like 'en', 'en-US', 'pt-BR'
  return /^[a-z]{2}(-[A-Z]{2})?$/.test(locale);
}

/**
 * Extracts locale codes from a localized field
 */
export function getLocalesFromField(field: LocalizedField | unknown): string[] {
  if (!isLocalizedField(field)) {
    return [];
  }
  
  return Object.keys(field).filter(isValidLocale);
}