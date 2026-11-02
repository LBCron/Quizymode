using System.Buffers.Binary;
using System.Text;
using SkiaSharp;

namespace Quizymode.Api.Tests.Features.Media;

/// <summary>Deterministic image fixtures generated in code, so no binary files are committed.</summary>
internal static class MediaTestImages
{
    public static byte[] Encode(SKBitmap bitmap, SKEncodedImageFormat format, int quality = 90)
    {
        using SKImage image = SKImage.FromBitmap(bitmap);
        using SKData data = image.Encode(format, quality);
        return data.ToArray();
    }

    public static byte[] Png(int width, int height, SKColor color)
    {
        using SKBitmap bitmap = new(width, height);
        bitmap.Erase(color);
        return Encode(bitmap, SKEncodedImageFormat.Png, 100);
    }

    /// <summary>Left half red, right half blue.</summary>
    public static SKBitmap TwoColor(int width, int height)
    {
        SKBitmap bitmap = new(width, height);
        using SKCanvas canvas = new(bitmap);
        canvas.Clear(SKColors.Blue);
        using SKPaint red = new() { Color = SKColors.Red };
        canvas.DrawRect(0, 0, width / 2f, height, red);
        return bitmap;
    }

    /// <summary>A flag-like image: flat stripes, a canton and an antialiased disc.</summary>
    public static byte[] FlagPng(int width = 960, int height = 640)
    {
        using SKBitmap bitmap = new(width, height);
        using (SKCanvas canvas = new(bitmap))
        {
            SKColor[] stripes = [new(0xB2, 0x22, 0x34), SKColors.White];
            float stripeHeight = height / 13f;
            for (int i = 0; i < 13; i++)
            {
                using SKPaint paint = new() { Color = stripes[i % 2] };
                canvas.DrawRect(0, i * stripeHeight, width, stripeHeight + 1, paint);
            }

            using SKPaint canton = new() { Color = new SKColor(0x3C, 0x3B, 0x6E) };
            canvas.DrawRect(0, 0, width * 0.4f, stripeHeight * 7, canton);
            using SKPaint star = new() { Color = SKColors.White, IsAntialias = true };
            for (int row = 0; row < 5; row++)
            {
                for (int column = 0; column < 6; column++)
                {
                    canvas.DrawCircle(30 + column * 60, 30 + row * 60, 12, star);
                }
            }
        }

        return Encode(bitmap, SKEncodedImageFormat.Png, 100);
    }

    /// <summary>A chart: grid, axes, a polyline with markers and labels on a white background.</summary>
    public static byte[] GraphPng(int width = 1280, int height = 800)
    {
        using SKBitmap bitmap = new(width, height);
        using (SKCanvas canvas = new(bitmap))
        {
            canvas.Clear(SKColors.White);
            using SKPaint grid = new() { Color = new SKColor(0xDD, 0xDD, 0xDD), StrokeWidth = 1, IsAntialias = true };
            for (int x = 100; x < width - 40; x += 100)
            {
                canvas.DrawLine(x, 40, x, height - 80, grid);
            }

            for (int y = 40; y < height - 80; y += 80)
            {
                canvas.DrawLine(100, y, width - 40, y, grid);
            }

            using SKPaint axis = new() { Color = SKColors.Black, StrokeWidth = 3, IsAntialias = true };
            canvas.DrawLine(100, 40, 100, height - 80, axis);
            canvas.DrawLine(100, height - 80, width - 40, height - 80, axis);

            using SKPaint line = new() { Color = new SKColor(0x1F, 0x77, 0xB4), StrokeWidth = 4, IsAntialias = true, Style = SKPaintStyle.Stroke };
            using SKPath path = new();
            for (int i = 0; i <= 10; i++)
            {
                float x = 100 + i * 110;
                float y = height - 80 - (float)(Math.Sin(i / 2.0) * 200 + 260);
                if (i == 0)
                {
                    path.MoveTo(x, y);
                }
                else
                {
                    path.LineTo(x, y);
                }
            }

            canvas.DrawPath(path, line);
            using SKFont font = new() { Size = 22 };
            using SKPaint text = new() { Color = SKColors.Black, IsAntialias = true };
            for (int i = 0; i <= 10; i++)
            {
                canvas.DrawText($"{i * 10}", 100 + i * 110 - 12, height - 50, SKTextAlign.Left, font, text);
            }

            canvas.DrawText("Response time (ms) vs load", 420, 30, SKTextAlign.Left, font, text);
        }

        return Encode(bitmap, SKEncodedImageFormat.Png, 100);
    }

    /// <summary>A schema/diagram: labelled boxes joined by arrows on a white background.</summary>
    public static byte[] SchemaPng(int width = 1280, int height = 720)
    {
        using SKBitmap bitmap = new(width, height);
        using (SKCanvas canvas = new(bitmap))
        {
            canvas.Clear(SKColors.White);
            using SKPaint fill = new() { Color = new SKColor(0xE8, 0xF0, 0xFE), IsAntialias = true };
            using SKPaint border = new() { Color = new SKColor(0x1A, 0x56, 0xDB), StrokeWidth = 3, IsAntialias = true, Style = SKPaintStyle.Stroke };
            using SKPaint arrow = new() { Color = SKColors.Black, StrokeWidth = 3, IsAntialias = true };
            using SKFont font = new() { Size = 28 };
            using SKPaint text = new() { Color = SKColors.Black, IsAntialias = true };
            string[] labels = ["Client", "API", "Normalizer", "Database", "Object store", "Reader"];
            for (int i = 0; i < labels.Length; i++)
            {
                float left = 60 + (i % 3) * 400;
                float top = 120 + (i / 3) * 340;
                SKRect box = new(left, top, left + 300, top + 140);
                canvas.DrawRoundRect(box, 14, 14, fill);
                canvas.DrawRoundRect(box, 14, 14, border);
                canvas.DrawText(labels[i], left + 24, top + 82, SKTextAlign.Left, font, text);
                if (i % 3 != 2)
                {
                    canvas.DrawLine(left + 300, top + 70, left + 400, top + 70, arrow);
                    canvas.DrawLine(left + 380, top + 58, left + 400, top + 70, arrow);
                    canvas.DrawLine(left + 380, top + 82, left + 400, top + 70, arrow);
                }
            }
        }

        return Encode(bitmap, SKEncodedImageFormat.Png, 100);
    }

    /// <summary>High-entropy noise: cannot be squeezed under a small byte cap.</summary>
    public static byte[] NoisyJpeg(int width, int height)
    {
        using SKBitmap bitmap = new(width, height);
        Random random = new(12345);
        byte[] pixels = new byte[width * height * 4];
        random.NextBytes(pixels);
        for (int i = 3; i < pixels.Length; i += 4)
        {
            pixels[i] = 255;
        }

        System.Runtime.InteropServices.Marshal.Copy(pixels, 0, bitmap.GetPixels(), pixels.Length);
        return Encode(bitmap, SKEncodedImageFormat.Jpeg, 95);
    }

    /// <summary>Inserts an EXIF APP1 segment (orientation plus a GPS IFD) right after the SOI marker.</summary>
    public static byte[] WithExif(byte[] jpeg, ushort orientation)
    {
        List<byte> tiff = [];
        tiff.AddRange("II"u8.ToArray());
        tiff.AddRange(new byte[] { 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00 });
        // IFD0 at offset 8: two entries (Orientation, GPSInfo pointer) then no next IFD.
        tiff.AddRange(new byte[] { 0x02, 0x00 });
        tiff.AddRange(Entry(0x0112, 3, 1, orientation));
        tiff.AddRange(Entry(0x8825, 4, 1, 38));
        tiff.AddRange(new byte[] { 0x00, 0x00, 0x00, 0x00 });
        // GPS IFD at offset 38: GPSLatitudeRef = "N".
        tiff.AddRange(new byte[] { 0x01, 0x00 });
        tiff.AddRange(new byte[] { 0x01, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00, 0x00, (byte)'N', 0x00, 0x00, 0x00 });
        tiff.AddRange(new byte[] { 0x00, 0x00, 0x00, 0x00 });

        List<byte> segment = [0xFF, 0xE1];
        int length = 2 + 6 + tiff.Count;
        segment.Add((byte)(length >> 8));
        segment.Add((byte)(length & 0xFF));
        segment.AddRange("Exif\0\0"u8.ToArray());
        segment.AddRange(tiff);

        List<byte> result = [.. jpeg.Take(2), .. segment, .. jpeg.Skip(2)];
        return result.ToArray();

        static byte[] Entry(ushort tag, ushort type, uint count, uint value)
        {
            byte[] entry = new byte[12];
            BinaryPrimitives.WriteUInt16LittleEndian(entry.AsSpan(0, 2), tag);
            BinaryPrimitives.WriteUInt16LittleEndian(entry.AsSpan(2, 2), type);
            BinaryPrimitives.WriteUInt32LittleEndian(entry.AsSpan(4, 4), count);
            BinaryPrimitives.WriteUInt32LittleEndian(entry.AsSpan(8, 4), value);
            return entry;
        }
    }

    /// <summary>A PNG header declaring the given size followed by a bogus IDAT and IEND; no pixel data exists.</summary>
    public static byte[] HeaderOnlyPng(uint width, uint height)
    {
        using MemoryStream stream = new();
        stream.Write([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        byte[] ihdr = new byte[13];
        BinaryPrimitives.WriteUInt32BigEndian(ihdr.AsSpan(0, 4), width);
        BinaryPrimitives.WriteUInt32BigEndian(ihdr.AsSpan(4, 4), height);
        ihdr[8] = 8;
        ihdr[9] = 6;
        WriteChunk(stream, "IHDR", ihdr);
        WriteChunk(stream, "IDAT", [0x78, 0x9C, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01]);
        WriteChunk(stream, "IEND", []);
        return stream.ToArray();
    }

    /// <summary>Inserts an acTL chunk before the first IDAT, which is what makes a PNG an APNG.</summary>
    public static byte[] ToApng(byte[] png)
    {
        int idat = IndexOfChunk(png, "IDAT");
        byte[] actl = new byte[8];
        BinaryPrimitives.WriteUInt32BigEndian(actl.AsSpan(0, 4), 2);
        using MemoryStream stream = new();
        stream.Write(png, 0, idat);
        WriteChunk(stream, "acTL", actl);
        stream.Write(png, idat, png.Length - idat);
        return stream.ToArray();
    }

    /// <summary>Inserts <paramref name="count"/> copies of a chunk (type, data) before the first IDAT.</summary>
    public static byte[] WithChunksBeforeIdat(byte[] png, string type, byte[] data, int count)
    {
        int idat = IndexOfChunk(png, "IDAT");
        using MemoryStream stream = new();
        stream.Write(png, 0, idat);
        for (int i = 0; i < count; i++)
        {
            WriteChunk(stream, type, data);
        }

        stream.Write(png, idat, png.Length - idat);
        return stream.ToArray();
    }

    /// <summary>A PNG followed by bytes after IEND and a tEXt chunk, as a polyglot upload would carry.</summary>
    public static byte[] PolyglotPng(byte[] png, string payload)
    {
        int iend = IndexOfChunk(png, "IEND");
        using MemoryStream stream = new();
        stream.Write(png, 0, iend);
        WriteChunk(stream, "tEXt", Encoding.ASCII.GetBytes("Comment\0" + payload));
        stream.Write(png, iend, png.Length - iend);
        stream.Write(Encoding.ASCII.GetBytes(payload));
        return stream.ToArray();
    }

    /// <summary>A WebP container whose VP8X flags say animated, with an ANIM chunk.</summary>
    public static byte[] AnimatedWebP()
    {
        using MemoryStream body = new();
        body.Write("WEBP"u8);
        byte[] vp8x = new byte[10];
        vp8x[0] = 0x02;
        vp8x[4] = 9;
        vp8x[7] = 9;
        WriteRiffChunk(body, "VP8X", vp8x);
        WriteRiffChunk(body, "ANIM", new byte[6]);
        using MemoryStream file = new();
        file.Write("RIFF"u8);
        file.Write(BitConverter.GetBytes((uint)body.Length));
        file.Write(body.ToArray());
        return file.ToArray();
    }

    public static IReadOnlyList<string> WebPChunks(byte[] webp)
    {
        List<string> chunks = [];
        int offset = 12;
        while (offset + 8 <= webp.Length)
        {
            chunks.Add(Encoding.ASCII.GetString(webp, offset, 4));
            uint length = BinaryPrimitives.ReadUInt32LittleEndian(webp.AsSpan(offset + 4, 4));
            offset += 8 + (int)length + (int)(length & 1);
        }

        return chunks;
    }

    /// <summary>Wraps a file in a multipart/form-data body (field "file") for tests that call the reader directly.</summary>
    public static (byte[] Body, string ContentType) Multipart(params (string Field, byte[] Content)[] parts)
    {
        const string boundary = "----qmtestboundary";
        using MemoryStream stream = new();
        foreach ((string field, byte[] content) in parts)
        {
            stream.Write(Encoding.ASCII.GetBytes($"--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"x.png\"\r\nContent-Type: image/png\r\n\r\n"));
            stream.Write(content);
            stream.Write("\r\n"u8);
        }

        stream.Write(Encoding.ASCII.GetBytes($"--{boundary}--\r\n"));
        return (stream.ToArray(), $"multipart/form-data; boundary={boundary}");
    }

    private static int IndexOfChunk(byte[] png, string type)
    {
        int offset = 8;
        while (offset + 8 <= png.Length)
        {
            uint length = BinaryPrimitives.ReadUInt32BigEndian(png.AsSpan(offset, 4));
            if (Encoding.ASCII.GetString(png, offset + 4, 4) == type)
            {
                return offset;
            }

            offset += 12 + (int)length;
        }

        throw new InvalidOperationException($"Chunk {type} not found.");
    }

    private static void WriteChunk(Stream stream, string type, byte[] data)
    {
        byte[] typeBytes = Encoding.ASCII.GetBytes(type);
        byte[] length = new byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(length, (uint)data.Length);
        stream.Write(length);
        stream.Write(typeBytes);
        stream.Write(data);
        uint crc = Crc32([.. typeBytes, .. data]);
        byte[] crcBytes = new byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(crcBytes, crc);
        stream.Write(crcBytes);
    }

    private static void WriteRiffChunk(Stream stream, string type, byte[] data)
    {
        stream.Write(Encoding.ASCII.GetBytes(type));
        stream.Write(BitConverter.GetBytes((uint)data.Length));
        stream.Write(data);
        if (data.Length % 2 == 1)
        {
            stream.WriteByte(0);
        }
    }

    private static uint Crc32(byte[] data)
    {
        uint crc = 0xFFFFFFFF;
        foreach (byte b in data)
        {
            crc ^= b;
            for (int i = 0; i < 8; i++)
            {
                crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB88320 : crc >> 1;
            }
        }

        return ~crc;
    }
}
