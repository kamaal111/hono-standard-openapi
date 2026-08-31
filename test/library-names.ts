export const LIBRARY_NAMES = ['ArkType', 'Zod', 'Zod Mini', 'Valibot', 'Sury', 'VineJS'] as const;

export type LibraryName = (typeof LIBRARY_NAMES)[number];

export type LibraryRecord<T> = Record<LibraryName, T>;

export function listLibraries<T>(
  record: Record<LibraryName, T | null>,
): readonly (T & { readonly name: LibraryName })[] {
  return LIBRARY_NAMES.flatMap(name => {
    const library = record[name];

    return library == null ? [] : [{ ...library, name }];
  });
}
