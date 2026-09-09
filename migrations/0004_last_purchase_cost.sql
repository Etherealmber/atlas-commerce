-- Optional column: last purchase unit price (MAC updates products.cost)
ALTER TABLE products ADD COLUMN last_purchase_cost REAL;
