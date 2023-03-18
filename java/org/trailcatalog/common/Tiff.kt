package org.trailcatalog.common

enum class TiffTagType(val id: UShort) {
  // https://www.awaresystems.be/imaging/tiff/tifftags/baseline.html
  // https://www.loc.gov/preservation/digital/formats/content/tiff_tags.shtml
  ImageWidth(256.toUShort()),
  ImageHeight(257.toUShort()),
  BitsPerSample(258.toUShort()),
  Compression(259.toUShort()),
  PhotometricInterpretation(262.toUShort()),
  SamplesPerPixel(277.toUShort()),
  PlanarConfiguration(284.toUShort()),
  Predictor(317.toUShort()),
  TileWidth(322.toUShort()),
  TileLength(323.toUShort()), // aka height
  TileOffsets(324.toUShort()),
  TileByteCounts(325.toUShort()),
  SubIFDs(330.toUShort()),
  SampleFormat(339.toUShort()),
  ModelPixelScaleTag(33550.toUShort()),
  ModelTiepointTag(33922.toUShort()),
  GeoKeyDirectoryTag(34735.toUShort()),
  GeoDoubleParamsTag(34736.toUShort()),
  GeoAsciiParamsTag(34737.toUShort()),
  GDAL_METADATA(42112.toUShort()),
  GDAL_NODATA(42113.toUShort()),
}

enum class TiffDataType(val id: kotlin.UShort) {
  // http://paulbourke.net/dataformats/tiff/tiff_summary.pdf
  UByte(1.toUShort()),
  Ascii(2.toUShort()),
  UShort(3.toUShort()),
  UInt(4.toUShort()),
  Float(11.toUShort()),
  Double(12.toUShort()),
}

enum class CompressionType(val id: UShort) {
  // https://www.awaresystems.be/imaging/tiff/tifftags/compression.html
  None(1.toUShort()),
  Lzw(5.toUShort()),
  AdobeDeflate(8.toUShort()),
}

enum class PredictorType(val id: UShort) {
  None(1.toUShort()),
  Horizontal(2.toUShort()),
  FloatingPoint(3.toUShort()),
}

enum class SampleFormat(val id: UShort) {
  UInt(1.toUShort()),
  Int(2.toUShort()),
  Float(3.toUShort()),
}
