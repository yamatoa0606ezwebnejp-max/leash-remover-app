import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export const PRINT_PRESETS = [
  { id: 'square', label: 'Square' },
  { id: 'a4', label: 'A4' },
  { id: 'landscape', label: 'Landscape' },
] as const;

export type PrintPresetId = (typeof PRINT_PRESETS)[number]['id'];

// A4's ratio is fixed (ISO 216, long:short = sqrt(2)) and follows the
// source photo's own orientation rather than forcing one. "Landscape" is a
// classic wide print ratio (3:2, e.g. a 6x4 print) and always crops to a
// wide frame even out of a portrait source, since that's the whole point
// of picking it.
function targetRatio(preset: PrintPresetId, sourceWidth: number, sourceHeight: number) {
  switch (preset) {
    case 'square':
      return 1;
    case 'a4':
      return sourceWidth >= sourceHeight ? Math.SQRT2 : 1 / Math.SQRT2;
    case 'landscape':
      return 3 / 2;
  }
}

function centeredCropRect(sourceWidth: number, sourceHeight: number, ratio: number) {
  const sourceRatio = sourceWidth / sourceHeight;
  if (sourceRatio > ratio) {
    const width = Math.round(sourceHeight * ratio);
    return { originX: Math.round((sourceWidth - width) / 2), originY: 0, width, height: sourceHeight };
  }
  const height = Math.round(sourceWidth / ratio);
  return { originX: 0, originY: Math.round((sourceHeight - height) / 2), width: sourceWidth, height };
}

function formatForContentType(contentType: string) {
  return contentType === 'image/png' ? SaveFormat.PNG : SaveFormat.JPEG;
}

// Crops the already-rendered removal result to the chosen preset's aspect
// ratio, entirely on-device — the server always returns one full-frame
// image regardless of preset, so this is the only place the preset choice
// actually takes effect.
export async function applyPrintPreset(
  imageBase64: string,
  contentType: string,
  preset: PrintPresetId,
) {
  const dataUri = `data:${contentType};base64,${imageBase64}`;
  const original = await ImageManipulator.manipulate(dataUri).renderAsync();
  const ratio = targetRatio(preset, original.width, original.height);
  const rect = centeredCropRect(original.width, original.height, ratio);
  const cropped = await ImageManipulator.manipulate(original).crop(rect).renderAsync();
  const format = formatForContentType(contentType);
  const result = await cropped.saveAsync({ format, base64: true });
  if (!result.base64) {
    throw new Error('ImageManipulator did not return base64 data');
  }
  return {
    imageBase64: result.base64,
    contentType: format === SaveFormat.PNG ? 'image/png' : 'image/jpeg',
  };
}
