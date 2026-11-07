# PoC (T7): Somar ships as CFF-outline OpenType ("OTTO") even though the files are named .ttf.
# PowerPoint only embeds TrueType-outline fonts, so convert CFF -> glyf (quadratic) with fontTools,
# following fontTools' own Snippets/otf2ttf.py. Usage: python otf2ttf.py in.ttf out.ttf
import sys
from fontTools.ttLib import TTFont, newTable
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

src, dst = sys.argv[1], sys.argv[2]
font = TTFont(src)
assert font.sfntVersion == "OTTO", "not a CFF font"
glyph_order = font.getGlyphOrder()
gs = font.getGlyphSet()
glyf = newTable("glyf")
glyf.glyphOrder = glyph_order
glyf.glyphs = {}
for name in glyph_order:
    pen = TTGlyphPen(gs)
    gs[name].draw(Cu2QuPen(pen, max_err=1.0, reverse_direction=True))
    glyf[name] = pen.glyph()
font["loca"] = newTable("loca")
font["glyf"] = glyf
font["maxp"] = newTable("maxp")
maxp = font["maxp"]
maxp.tableVersion = 0x00010000
for k in ("maxZones", "maxTwilightPoints", "maxStorage", "maxFunctionDefs", "maxInstructionDefs", "maxStackElements", "maxSizeOfInstructions", "maxComponentElements"):
    setattr(maxp, k, 0)
maxp.maxZones = 1
post = font["post"]
post.formatType = 2.0
post.extraNames = []
post.mapping = {}
post.glyphOrder = glyph_order
font["head"].indexToLocFormat = 0
font["head"].glyphDataFormat = 0
del font["CFF "]
if "VORG" in font:
    del font["VORG"]
font.sfntVersion = "\x00\x01\x00\x00"
font.save(dst)
print("wrote", dst)
