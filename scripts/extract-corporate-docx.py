"""Bounded DOCX plain text via stdin, without extracting ZIP entries or following links."""
import io, sys, zipfile
import xml.etree.ElementTree as ET
MAX_INPUT=8*1024*1024
MAX_TEXT=256*1024

def extract_docx(data):
    if len(data)>MAX_INPUT: raise ValueError('Documento demasiado grande.')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries=archive.infolist()
        if len(entries)>2000 or sum(e.file_size for e in entries)>32*1024*1024: raise ValueError('Documento expandido demasiado grande.')
        names=[e.filename for e in entries]
        if len(names)!=len(set(names)): raise ValueError('Entradas duplicadas.')
        if any(e.flag_bits & 1 for e in entries): raise ValueError('Documento cifrado no admitido.')
        if any('vbaproject' in n.lower() or n.lower().endswith('.bin') for n in names): raise ValueError('Macros y objetos incrustados no admitidos.')
        if '[Content_Types].xml' not in names or 'word/document.xml' not in names: raise ValueError('No es un DOCX válido.')
        parts=['word/document.xml']+[n for n in names if n.startswith('word/') and n.endswith('.xml') and (n.rsplit('/',1)[-1].startswith(('header','footer')) or n in ['word/footnotes.xml','word/endnotes.xml'])]
        output=[]; size=0
        for name in parts:
            entry=archive.getinfo(name)
            if entry.file_size>4*1024*1024: raise ValueError('Parte XML demasiado grande.')
            with archive.open(entry) as source:
                xml=source.read(4*1024*1024+1)
            if b'\x00' in xml or len(xml)>4*1024*1024 or b'<!DOCTYPE' in xml.upper() or b'<!ENTITY' in xml.upper(): raise ValueError('XML no admitido.')
            tree=ET.fromstring(xml)
            for paragraph in tree.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'):
                text=''.join(n.text or '' for n in paragraph.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t'))
                size+=len(text.encode('utf-8'))+1
                if size>MAX_TEXT: raise ValueError('Texto demasiado grande.')
                output.append(text)
        return '\n'.join(output)

if __name__=='__main__':
    try:
        data=sys.stdin.buffer.read(MAX_INPUT+1)
        text=extract_docx(data)
        sys.stdout.buffer.write(text.encode('utf-8'))
    except Exception:
        sys.stderr.write('No se pudo leer el DOCX con los límites locales.\n')
        sys.exit(2)
