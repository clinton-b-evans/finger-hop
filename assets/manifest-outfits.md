# Outfits, animals & props (assets-outfits-animals)

Same style as the fox: chubby cel-shaded cartoon, transparent PNG (RGBA), 6px padding.
Anchors are fractions of the image (x from left, y from top).

## Playable animals (352px tall, same as fox_*)
| File | What | Anchor (feet) | Head anchor | Eyes anchor | Neck anchor |
|---|---|---|---|---|---|
| wolf_idle.png | Grey wolf, standing | (0.40, 0.98) | (0.40, 0.12) | (0.40, 0.33) | (0.40, 0.52) |
| wolf_jump.png | Grey wolf, jump, arms up | (0.45, 0.95) | (0.48, 0.12) | (0.48, 0.32) | (0.48, 0.50) |
| bear_idle.png | Brown bear, standing | (0.50, 0.98) | (0.50, 0.08) | (0.50, 0.30) | (0.50, 0.50) |
| bear_jump.png | Brown bear, jump, arms up | (0.45, 0.95) | (0.50, 0.10) | (0.50, 0.30) | (0.50, 0.50) |

No crouch/land/cheer/wave poses yet; reuse idle/jump for those.

## Wearables (overlays; place anchor of item on the matching character anchor, scale ~0.45x char width for hats)
| File | Slot | Item anchor |
|---|---|---|
| hat_party.png | head | (0.50, 0.95) bottom-centre |
| hat_crown.png | head | (0.50, 0.95) bottom-centre |
| hat_pirate.png | head | (0.50, 0.85) brim centre |
| hat_wizard.png | head | (0.45, 0.85) brim centre |
| wear_sunglasses.png | eyes | (0.50, 0.40) bridge |
| wear_mask.png | eyes | (0.50, 0.45) bridge |
| wear_scarf.png | neck | (0.50, 0.20) top-centre |
| wear_cape.png | back/neck (draw behind body) | (0.55, 0.08) clasp |

## Level props / collectibles (~222px tall)
| File | What | Anchor |
|---|---|---|
| gem.png | blue gem collectible | (0.50, 0.95) |
| heart.png | red heart collectible | (0.50, 0.95) |
| star_alt.png | alternate gold star | (0.50, 0.95) |
| mushroom.png | red spotted mushroom | (0.50, 0.97) base |
| rock.png | mossy rock obstacle | (0.50, 0.92) base |
| flower_tulip.png | pink tulip decoration | (0.50, 0.97) base |

Existing tree.png, chest.png, star.png, flowers.png were reused (not regenerated).
