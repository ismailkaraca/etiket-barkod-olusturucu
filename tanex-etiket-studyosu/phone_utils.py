"""Telefonların etiketlerde tutarlı gösterimi (ham Excel hücrelerini değiştirmez)."""
from __future__ import annotations
import re


def format_phone(value):
    """10 haneli Türkiye telefonlarını (212) 542-40-81 biçiminde göster."""
    raw = str(value if value is not None else '').strip()
    # Excel'de sayısal hücreler bazen 2125424081.0 olarak iletilebiliyor.
    if re.fullmatch(r'[0-9]{10,14}\.0', raw):
        raw = raw[:-2]
    digits = re.sub(r'\D', '', raw)
    if len(digits) == 14 and digits.startswith('0090'):
        digits = digits[4:]
    if len(digits) == 12 and digits.startswith('90'):
        digits = digits[2:]
    if len(digits) == 11 and digits.startswith('0'):
        digits = digits[1:]
    if len(digits) != 10:
        return raw
    return f'({digits[:3]}) {digits[3:6]}-{digits[6:8]}-{digits[8:]}'


def is_phone_field(label):
    """Telefon sütunlarını seç; barkod, kod veya miktar sütunlarını dönüştürme."""
    name = str(label if label is not None else '').casefold()
    return bool(re.search(r'telefon|(?<!\w)(?:tel|gsm|cep|phone|mobile)(?!\w)', name))
