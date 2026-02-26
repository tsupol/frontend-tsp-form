# Finance & Contract System

## Price / Cost (Singleton per SKU)

- Each SKU product (e.g. "iPhone 17 Pro", "iPhone 17") has exactly one **price** (selling price) and one **cost** (acquisition cost)
- Price and cost are configured by admin (separate admin page, covered later)

## Finance Types

### fin1 (price-based)

- Base amount = **price**
- Down payment = **fixed percentage** (`down_percent`, not arbitrary)
- Term = flexible (`term_months`, any number of months)
- Interest rate is embedded in the formula (not an input)

### fin2 (cost-based, more widely used)

- Base amount = **cost**
- Down payment = **arbitrary amount** (employee can freely negotiate)
- Term = flexible (`term_months`, any number of months)
- Interest rate is embedded in the formula (not an input)

## Contract Creation Flow (Employee-facing)

1. Employee selects a SKU product
2. Chooses finance type (fin1 or fin2)
3. Inputs: `down_percent` (fin1) or down payment amount (fin2), `term_months`, optionally `branch_id`
4. Server calculates and returns the contract numbers (formula output)
5. Employee uses these numbers while negotiating with the customer
6. System is a tool to assist — not strictly enforced

## Architecture Notes

- All formula calculation happens on the **server**
- Frontend sends: fin type, term_months, down payment, branch_id
- Server returns: calculated contract breakdown
- Admin setup page (price/cost config, formula parameters) is a separate scope
