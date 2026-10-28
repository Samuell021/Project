import unicodedata


def normalize_phone(value):
    digits = "".join(str(unicodedata.decimal(character)) for character in str(value or "") if character.isdecimal())
    if digits.startswith("0098"):
        digits = "0" + digits[4:]
    elif digits.startswith("98") and len(digits) > 10:
        digits = "0" + digits[2:]
    return digits
