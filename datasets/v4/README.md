# Frozen synthetic OCR corpus V4

42 newly rendered fictional documents: 18 development, 12 validation and 12 held-out. Layout families and fonts differ across the three partitions. The manifest records image/font hashes, exact values, deliberate omissions/conflicting identifiers, scan variation, dimensions and renderer coordinates. All images explicitly state that they are synthetic and do not represent authentic deposits.

The corpus is frozen before recognition changes at the recorded baseline commit. Development and validation may inform improvements. The held-out partition must receive its first recognition only after the revised recognition code is frozen; do not tune against those results. Previously evaluated V1/V2/V3 are regression corpora, and their original files stay unchanged.

The generation script refuses to overwrite the manifest. Windows font files are referenced by name/hash; the font files themselves are not redistributed. Rendered PNGs are the fixed benchmark inputs. IFSC directory versions identify public branch-reference data only, with no deposit or issuer authentication.

Coordinate boxes describe the original unrotated canvas. Stored images with a declared right-angle rotation need the corresponding coordinate transform. A missing or uncertain field must remain missing or require review. No ground truth or expected identifier may enter recognition, candidate selection or normalization.

Report per-field exact match, coverage, incorrect unflagged candidates, explicit review/withheld values, intentional absences, per-layout results, processing failures and measured worker startup/warm runtime/CPU/memory. Small synthetic results do not establish real-bank-document accuracy or a production SLA.

Layout generalization limit: R retains two-column geometry similar to development with a different font; S changes font and field order. The split tests new inputs/font/order under frozen code, not wholly novel geometry or representative real-bank documents.
