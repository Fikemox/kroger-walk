// Store catalog. Order here = walking order used for grouping the list.
// Items are "Name|price". Prices are rough estimates, not real Kroger prices.
const CATALOG = [
  // ---------- PRODUCE ----------
  { id: 'fruit', name: 'Fresh Fruit', dept: 'Produce', color: '#8be36f', items: `
Bananas (lb)|0.59
Gala Apples (lb)|1.99
Honeycrisp Apples (lb)|2.99
Navel Oranges (each)|0.99
Clementines (3 lb bag)|5.99
Lemons (each)|0.69
Limes (each)|0.39
Red Seedless Grapes (lb)|2.99
Bartlett Pears (lb)|1.79
Mango (each)|1.29
Pineapple (each)|3.49` },
  { id: 'berries', name: 'Berries & Melons', dept: 'Produce', color: '#ff7a9c', items: `
Strawberries (1 lb)|3.99
Blueberries (1 pint)|4.49
Raspberries (6 oz)|3.99
Blackberries (6 oz)|3.49
Seedless Watermelon (each)|6.99
Cantaloupe (each)|3.49
Honeydew (each)|3.99
Cut Fruit Medley (32 oz)|7.99` },
  { id: 'salad', name: 'Salads & Greens', dept: 'Produce', color: '#5fd35f', items: `
Spring Mix (5 oz)|3.99
Romaine Hearts (3 ct)|3.99
Baby Spinach (5 oz)|3.49
Iceberg Lettuce (head)|1.79
Caesar Salad Kit|3.99
Chopped Salad Kit|4.49
Coleslaw Mix (14 oz)|1.99
Kale (bunch)|2.49
Arugula (5 oz)|3.99` },
  { id: 'veg', name: 'Fresh Vegetables', dept: 'Produce', color: '#6fd66f', items: `
Broccoli Crowns (lb)|1.99
Carrots (2 lb bag)|1.99
Celery (bunch)|1.99
Cucumber (each)|0.79
Zucchini (lb)|1.49
Green Beans (lb)|2.49
Sweet Corn (ear)|0.59
Asparagus (lb)|3.99
Cauliflower (head)|3.49
Brussels Sprouts (lb)|3.49` },
  { id: 'roots', name: 'Potatoes, Onions & Garlic', dept: 'Produce', color: '#d7b77a', items: `
Russet Potatoes (5 lb)|4.49
Baby Gold Potatoes (1.5 lb)|3.99
Sweet Potatoes (lb)|1.29
Yellow Onions (3 lb)|3.49
Red Onion (each)|1.29
Green Onions (bunch)|0.99
Garlic (3 ct)|1.99
Ginger Root (lb)|3.99` },
  { id: 'peppers', name: 'Tomatoes, Peppers & Avocados', dept: 'Produce', color: '#ff6b5a', items: `
Roma Tomatoes (lb)|1.49
Tomatoes on the Vine (lb)|2.49
Cherry Tomatoes (pint)|2.99
Hass Avocado (each)|1.25
Green Bell Pepper (each)|0.99
Red Bell Pepper (each)|1.49
Mini Sweet Peppers (1 lb)|3.99
Jalapeños (lb)|1.49` },
  { id: 'herbs', name: 'Herbs, Mushrooms & Tofu', dept: 'Produce', color: '#a8e070', items: `
Cilantro (bunch)|0.99
Italian Parsley (bunch)|0.99
Fresh Basil (0.75 oz)|2.49
Fresh Mint (0.75 oz)|2.29
Fresh Rosemary (0.75 oz)|2.29
White Mushrooms (8 oz)|2.49
Baby Bella Mushrooms (8 oz)|2.79
Firm Tofu (14 oz)|2.49` },

  // ---------- BACK WALL ----------
  { id: 'bakery', name: 'Bakery', dept: 'Bakery', color: '#e8b86a', items: `
Butter Croissants (4 ct)|5.99
French Baguette|2.99
Sourdough Round|4.49
Glazed Donuts (6 ct)|4.99
Blueberry Muffins (4 ct)|5.49
Cinnamon Rolls (4 ct)|5.99
Chocolate Chip Cookies (12 ct)|4.99
Kaiser Rolls (6 ct)|3.49
Apple Pie (8 in)|7.99
Quarter Sheet Birthday Cake|24.99` },
  { id: 'deli', name: 'Deli', dept: 'Deli', color: '#f29b4b', items: `
Boar's Head Oven Roasted Turkey (lb)|13.99
Black Forest Ham (lb)|10.99
Sliced Provolone (lb)|9.99
Rotisserie Chicken|7.99
Fried Chicken (8 pc)|11.99
Chicken Tenders (8 pc)|8.99
Italian Sub Sandwich|7.99
Potato Salad (lb)|4.99
Mac & Cheese (lb)|5.99
Hummus (10 oz)|4.49
California Roll Sushi|7.99` },
  { id: 'meat', name: 'Meat', dept: 'Meat & Seafood', color: '#ff5f5f', items: `
Ground Beef 80/20 (lb)|5.49
Boneless Chicken Breast (lb)|3.99
Chicken Thighs (lb)|2.49
Ribeye Steak (lb)|14.99
Boneless Pork Chops (lb)|4.29
Pork Shoulder (lb)|2.99
Beef Stew Meat (lb)|7.99
Ground Turkey (lb)|4.99
Thick Cut Bacon (16 oz)|6.99
Italian Sausage (19 oz)|5.49
Hot Dogs (8 ct)|3.99` },
  { id: 'seafood', name: 'Seafood', dept: 'Meat & Seafood', color: '#4fd2e8', items: `
Atlantic Salmon Fillet (lb)|10.99
Raw Shrimp 16/20 (lb)|9.99
Cooked Shrimp Ring|7.99
Tilapia Fillets (lb)|6.99
Cod Fillets (lb)|9.99
Tuna Steak (lb)|14.99
Sea Scallops (lb)|21.99
Snow Crab Legs (lb)|19.99` },

  // ---------- CENTER STORE ----------
  { id: 'bread', name: 'Bread & Tortillas', dept: 'Grocery', color: '#e3c27a', items: `
White Sandwich Bread|2.99
Dave's Killer Bread 21 Grain|5.99
Hamburger Buns (8 ct)|2.29
Hot Dog Buns (8 ct)|2.29
Plain Bagels (6 ct)|3.49
English Muffins (6 ct)|3.49
King's Hawaiian Rolls (12 ct)|4.49
Flour Tortillas (10 ct)|2.99
Corn Tortillas (30 ct)|2.49` },
  { id: 'cereal', name: 'Cereal & Breakfast', dept: 'Grocery', color: '#e6cf6b', items: `
Cheerios (18 oz)|4.99
Honey Nut Cheerios (18.8 oz)|5.29
Frosted Flakes (24 oz)|4.79
Cinnamon Toast Crunch (18.8 oz)|4.99
Lucky Charms (18.6 oz)|5.29
Raisin Bran (16.6 oz)|4.49
Quaker Old Fashioned Oats (42 oz)|5.99
Instant Oatmeal (10 ct)|4.29
Pop-Tarts (8 ct)|3.99
Granola (12 oz)|3.99` },
  { id: 'coffee', name: 'Coffee & Tea', dept: 'Grocery', color: '#c9905a', items: `
Folgers Classic Roast (25 oz)|12.99
Starbucks Pike Place Ground (12 oz)|9.99
Dunkin' Original K-Cups (12 ct)|9.49
Maxwell House (24 oz)|7.99
Coffee Filters (200 ct)|2.49
Lipton Black Tea (100 ct)|5.99
Celestial Sleepytime Tea (20 ct)|4.29
Bigelow Green Tea (20 ct)|3.99
Swiss Miss Cocoa (8 ct)|3.49` },
  { id: 'spreads', name: 'PB, Jelly & Syrup', dept: 'Grocery', color: '#e6b36b', items: `
Jif Creamy Peanut Butter (16 oz)|3.49
Skippy Crunchy Peanut Butter (16 oz)|3.49
Smucker's Strawberry Jam (18 oz)|3.99
Grape Jelly (30 oz)|2.99
Nutella (13 oz)|4.99
Clover Honey (12 oz)|5.99
Pure Maple Syrup (12 oz)|9.99
Pancake Syrup (24 oz)|3.99
Bisquick Pancake Mix (40 oz)|4.49` },
  { id: 'baking', name: 'Baking', dept: 'Grocery', color: '#f0e0b0', items: `
All-Purpose Flour (5 lb)|3.49
Granulated Sugar (4 lb)|3.99
Light Brown Sugar (2 lb)|2.99
Powdered Sugar (2 lb)|2.49
Baking Soda (1 lb)|1.29
Baking Powder (8.1 oz)|2.99
Pure Vanilla Extract (2 oz)|7.99
Semi-Sweet Chocolate Chips (12 oz)|3.99
Yellow Cake Mix|1.99
Chocolate Frosting|2.29
Cornstarch (16 oz)|1.99
Active Dry Yeast (3 pk)|1.99` },
  { id: 'spices', name: 'Spices & Seasonings', dept: 'Grocery', color: '#e07a3a', items: `
Iodized Salt (26 oz)|1.29
Ground Black Pepper (3 oz)|4.99
Garlic Powder|3.49
Onion Powder|3.49
Ground Cumin|3.29
Chili Powder|2.99
Smoked Paprika|3.99
Italian Seasoning|2.99
Ground Cinnamon|2.99
Crushed Red Pepper|2.99
Taco Seasoning Packet|0.99` },
  { id: 'oils', name: 'Oils, Vinegar & Dressing', dept: 'Grocery', color: '#d6d36b', items: `
Extra Virgin Olive Oil (16.9 oz)|8.99
Vegetable Oil (48 oz)|4.99
Cooking Spray|3.49
Toasted Sesame Oil|4.49
Balsamic Vinegar|3.99
Apple Cider Vinegar|2.99
Hidden Valley Ranch (16 oz)|3.49
Italian Dressing (16 oz)|2.99
Caesar Dressing (16 oz)|3.49` },
  { id: 'pasta', name: 'Pasta & Sauce', dept: 'Grocery', color: '#f2c66b', items: `
Spaghetti (1 lb)|1.49
Penne (1 lb)|1.49
Elbow Macaroni (1 lb)|1.49
Lasagna Noodles (1 lb)|2.29
Egg Noodles (12 oz)|2.49
Kraft Mac & Cheese|1.29
Rao's Marinara (24 oz)|8.99
Prego Traditional (24 oz)|3.49
Alfredo Sauce (15 oz)|3.29
Basil Pesto (6 oz)|4.99` },
  { id: 'rice', name: 'Rice, Beans & Grains', dept: 'Grocery', color: '#e8dca0', items: `
Long Grain White Rice (2 lb)|2.49
Jasmine Rice (5 lb)|7.99
Brown Rice (2 lb)|2.49
Minute Rice (14 oz)|3.99
Quinoa (12 oz)|4.99
Rice-A-Roni Chicken|1.49
Black Beans (15 oz can)|0.99
Pinto Beans (15 oz can)|0.99
Kidney Beans (15 oz can)|0.99
Chickpeas (15 oz can)|0.99
Dried Lentils (1 lb)|1.99` },
  { id: 'soup', name: 'Soup, Broth & Canned Meat', dept: 'Grocery', color: '#ff8a6b', items: `
Campbell's Chicken Noodle|1.49
Campbell's Tomato Soup|1.29
Cream of Mushroom|1.49
Progresso Chicken & Rice|2.99
Chicken Broth (32 oz)|2.49
Beef Broth (32 oz)|2.49
Ramen Noodles (12 pk)|3.49
Hormel Chili (15 oz)|2.99
Chunk Light Tuna (5 oz)|1.29
Canned Chicken (12.5 oz)|3.49
Spam (12 oz)|3.99` },
  { id: 'canned', name: 'Canned Veggies & Fruit', dept: 'Grocery', color: '#9cd46b', items: `
Cut Green Beans (14.5 oz)|0.89
Whole Kernel Corn (15 oz)|0.89
Diced Tomatoes (14.5 oz)|1.19
Crushed Tomatoes (28 oz)|1.79
Tomato Sauce (8 oz)|0.69
Tomato Paste (6 oz)|0.79
Pumpkin Purée (15 oz)|2.49
Sliced Peaches (15 oz)|1.99
Mandarin Oranges (15 oz)|1.49
Applesauce Cups (6 pk)|2.99` },
  { id: 'mexican', name: 'International: Mexican', dept: 'Grocery', color: '#ff9d3a', items: `
Taco Shells (12 ct)|2.49
Refried Beans (16 oz)|1.49
Red Enchilada Sauce (10 oz)|1.99
Diced Green Chiles (4 oz)|1.29
Chipotle Peppers in Adobo|1.99
Tostada Shells|2.99
Taco Sauce|1.99
Queso Dip (15 oz)|3.99` },
  { id: 'asian', name: 'International: Asian', dept: 'Grocery', color: '#ff5f8a', items: `
Kikkoman Soy Sauce (15 oz)|2.99
Sriracha (17 oz)|3.99
Teriyaki Sauce|3.29
Hoisin Sauce|2.99
Sweet Chili Sauce|2.99
Gochujang|5.99
Coconut Milk (13.5 oz)|2.49
Red Curry Paste|3.49
Rice Noodles (14 oz)|2.99
Panko Bread Crumbs|2.49` },
  { id: 'condiments', name: 'Condiments & Pickles', dept: 'Grocery', color: '#ffd84a', items: `
Heinz Ketchup (32 oz)|3.49
French's Yellow Mustard|1.99
Dijon Mustard|2.99
Hellmann's Mayo (30 oz)|5.99
BBQ Sauce (18 oz)|2.49
Frank's RedHot (12 oz)|3.49
Worcestershire Sauce|2.99
Dill Pickle Spears (24 oz)|3.49
Sweet Relish|2.29
Green Olives|2.99` },
  { id: 'chips', name: 'Chips & Salsa', dept: 'Snacks', color: '#ff9a4d', items: `
Lay's Classic (8 oz)|4.99
Doritos Nacho Cheese (9.25 oz)|5.49
Cheetos Crunchy|4.99
Kettle Brand Sea Salt|4.29
Pringles Original|2.49
Tostitos Scoops|5.49
Tortilla Chips (13 oz)|3.49
Pace Chunky Salsa (24 oz)|3.49
Mini Pretzels (16 oz)|3.49
Microwave Popcorn (6 ct)|4.49` },
  { id: 'crackers', name: 'Crackers & Cookies', dept: 'Snacks', color: '#f0b060', items: `
Ritz Crackers|4.29
Cheez-It (12.4 oz)|5.49
Goldfish (6.6 oz)|2.99
Triscuit|4.29
Saltines|2.99
Graham Crackers|4.49
Oreos (Family Size)|5.29
Chips Ahoy!|4.49
Pepperidge Farm Milano|4.79` },
  { id: 'candy', name: 'Candy, Nuts & Bars', dept: 'Snacks', color: '#ff70b0', items: `
M&M's Peanut (Share Size)|2.49
Reese's Cups (Share Size)|2.49
Snickers (Share Size)|2.49
Skittles (Share Size)|2.49
Gummy Bears|2.99
Mixed Nuts (16 oz)|9.99
Whole Almonds (16 oz)|6.99
Trail Mix (26 oz)|8.99
Nature Valley Bars (12 ct)|3.99
Clif Bar|1.79` },
  { id: 'soda', name: 'Soda & Juice', dept: 'Beverages', color: '#6aa8ff', items: `
Coca-Cola (12 pk)|7.99
Diet Coke (12 pk)|7.99
Pepsi (12 pk)|7.49
Sprite (12 pk)|7.99
Dr Pepper (12 pk)|7.99
Coca-Cola (2 L)|2.99
Apple Juice (64 oz)|3.49
Cranberry Juice Cocktail (64 oz)|3.99
Lemonade (52 oz)|2.99
Capri Sun (10 pk)|4.49` },
  { id: 'water', name: 'Water & Sports Drinks', dept: 'Beverages', color: '#7fd0ff', items: `
Spring Water (24 pk)|4.99
Smartwater (1 L)|2.29
LaCroix Lime (8 pk)|5.49
Topo Chico (12 pk)|14.99
Gatorade Variety (8 pk)|7.99
BodyArmor (16 oz)|2.49
Red Bull (4 pk)|9.99
Celsius (12 oz)|2.49
Liquid I.V. (6 ct)|6.99` },
  { id: 'beer', name: 'Beer & Wine', dept: 'Beverages', color: '#c88cff', items: `
Bud Light (12 pk)|13.99
Miller Lite (12 pk)|13.99
Modelo Especial (12 pk)|16.99
Craft IPA (6 pk)|10.99
White Claw Variety (12 pk)|17.99
Hard Cider (6 pk)|10.99
Cabernet Sauvignon|9.99
Pinot Grigio|8.99
Rosé|10.99
Prosecco|12.99` },
  { id: 'paper', name: 'Paper & Plastic', dept: 'Household', color: '#b5a0ff', items: `
Toilet Paper (12 mega rolls)|15.99
Paper Towels (6 rolls)|13.99
Kleenex Tissues|3.49
Napkins (250 ct)|3.99
Paper Plates (40 ct)|4.99
Solo Cups (50 ct)|5.49
Ziploc Gallon Bags|4.99
Trash Bags 13 gal (40 ct)|9.99
Aluminum Foil|4.49
Plastic Wrap|3.49` },
  { id: 'cleaning', name: 'Cleaning & Laundry', dept: 'Household', color: '#9ab0ff', items: `
Tide Pods (42 ct)|13.99
Dawn Dish Soap (19 oz)|3.99
Cascade Dishwasher Pods|12.99
Clorox Wipes (75 ct)|5.49
Lysol Spray|6.99
Windex|4.49
Scrub Sponges (6 pk)|3.99
Bleach (81 oz)|4.99
Bounce Dryer Sheets|7.99
Swiffer Wet Refills|7.49` },
  { id: 'health', name: 'Health & Beauty', dept: 'Health', color: '#ff8fc8', items: `
Crest Toothpaste|4.49
Toothbrushes (2 pk)|3.99
Dental Floss|2.99
Shampoo|7.99
Conditioner|7.99
Dove Body Wash|8.99
Deodorant|6.49
Razors (4 ct)|9.99
Advil (50 ct)|9.99
Tylenol Extra Strength (50 ct)|9.49
Band-Aids (30 ct)|4.49
Daily Multivitamin|10.99` },
  { id: 'pet', name: 'Pet & Baby', dept: 'Pet & Baby', color: '#a0e0a0', items: `
Dry Dog Food (15 lb)|21.99
Dog Treats|5.99
Dry Cat Food (3.15 lb)|7.99
Wet Cat Food (12 pk)|9.99
Clumping Cat Litter (14 lb)|12.99
Diapers (Jumbo Pack)|24.99
Baby Wipes (72 ct)|3.49
Baby Food Pouch|1.79
Infant Formula (30 oz)|29.99` },

  // ---------- FROZEN ----------
  { id: 'frozen-meals', name: 'Frozen Meals & Sides', dept: 'Frozen', color: '#8fd8ff', items: `
Stouffer's Lasagna (Family)|12.99
Lean Cuisine|2.99
Hot Pockets (2 ct)|3.49
Chicken Pot Pie|1.49
Frozen Burritos (8 ct)|5.99
Chicken Nuggets (2 lb)|8.99
Tater Tots (32 oz)|4.49
Crinkle Fries (32 oz)|3.99
Fish Sticks|4.99
Italian Meatballs (32 oz)|7.99` },
  { id: 'frozen-pizza', name: 'Frozen Pizza & Snacks', dept: 'Frozen', color: '#ffa07a', items: `
DiGiorno Rising Crust Pepperoni|7.99
Tombstone Pepperoni|4.99
Red Baron Classic|4.49
Totino's Pizza Rolls (40 ct)|4.99
Bagel Bites (9 ct)|3.99
Garlic Texas Toast|3.99
Mozzarella Sticks|6.99
Cauliflower Crust Pizza|7.49` },
  { id: 'ice-cream', name: 'Ice Cream & Treats', dept: 'Frozen', color: '#ffc6e8', items: `
Kroger Deluxe Ice Cream (48 oz)|3.99
Ben & Jerry's (pint)|5.99
Häagen-Dazs (pint)|5.49
Drumsticks (8 ct)|6.99
Ice Cream Sandwiches (12 ct)|5.49
Popsicles (12 ct)|3.99
Cool Whip (8 oz)|2.49
Bag of Ice (7 lb)|2.99` },
  { id: 'frozen-veg', name: 'Frozen Veggies & Breakfast', dept: 'Frozen', color: '#7fe0c0', items: `
Broccoli Florets (12 oz)|1.99
Mixed Vegetables (12 oz)|1.79
Sweet Corn (12 oz)|1.79
Sweet Peas (12 oz)|1.79
Stir Fry Vegetables|2.99
Mixed Berries (3 lb)|9.99
Eggo Waffles (10 ct)|3.99
Frozen Pancakes|3.99
Jimmy Dean Breakfast Sandwiches (4 ct)|7.99` },

  // ---------- DAIRY ----------
  { id: 'milk', name: 'Milk, Cream & Juice', dept: 'Dairy', color: '#eef0ff', items: `
2% Milk (gallon)|3.29
Whole Milk (gallon)|3.49
Fat Free Milk (gallon)|3.29
Chocolate Milk (half gal)|2.99
Oatly Oat Milk (64 oz)|5.49
Almond Milk (64 oz)|3.49
Half & Half (quart)|3.99
Heavy Whipping Cream (pint)|4.29
Coffee Creamer (32 oz)|4.99
Orange Juice (52 oz)|4.49` },
  { id: 'cheese', name: 'Cheese & Sour Cream', dept: 'Dairy', color: '#ffe680', items: `
Shredded Mozzarella (8 oz)|2.79
Shredded Cheddar (8 oz)|2.79
Sharp Cheddar Block (8 oz)|2.99
Sliced American (16 ct)|3.49
Sliced Swiss (8 oz)|3.99
Grated Parmesan (8 oz)|4.99
String Cheese (12 ct)|4.99
Brie (8 oz)|6.99
Cream Cheese (8 oz)|2.49
Sour Cream (16 oz)|2.29
Cottage Cheese (16 oz)|3.29` },
  { id: 'yogurt', name: 'Yogurt & Dough', dept: 'Dairy', color: '#d0e0ff', items: `
Chobani Greek Vanilla (32 oz)|5.99
Plain Greek Yogurt (32 oz)|5.49
Yoplait Strawberry (6 oz)|0.89
Activia (4 pk)|3.99
Go-GURT (8 ct)|3.49
Kefir (32 oz)|4.49
Pudding Cups (6 pk)|2.99
Pillsbury Grands Biscuits (8 ct)|3.49
Crescent Rolls (8 ct)|2.99
Cookie Dough (16 oz)|4.29` },
  { id: 'eggs', name: 'Eggs & Butter', dept: 'Dairy', color: '#fff3c0', items: `
Large Eggs (dozen)|3.49
Large Eggs (18 ct)|4.99
Cage-Free Eggs (dozen)|4.99
Hard-Boiled Eggs (6 ct)|3.99
Liquid Egg Whites (16 oz)|4.49
Salted Butter (1 lb)|4.99
Unsalted Butter (1 lb)|4.99
Margarine Spread (15 oz)|3.99` },

  // ---------- FRONT OF STORE ----------
  { id: 'floral', name: 'Floral', dept: 'Floral', color: '#ff6fd8', items: `
Mixed Bouquet|9.99
Dozen Roses|19.99
Potted Mum|9.99
Succulent|5.99
Mylar Balloon|3.99
Greeting Card|4.99` },
  { id: 'seasonal', name: 'Halloween Seasonal', dept: 'Seasonal', color: '#ff8a1f', items: `
Carving Pumpkin|4.99
Pie Pumpkin|2.99
Mini Gourds (bag)|3.99
Fun-Size Candy Variety (90 ct)|19.99
Candy Corn (15 oz)|2.99
Caramel Apple Kit|3.99
Apple Cider (gallon)|5.99
Pumpkin Spice Creamer|4.99
Kids' Costume|19.99
Fake Spider Webs|2.99` },
  { id: 'service', name: 'Customer Service', dept: 'Service', color: '#9aa4b8', items: `
Kroger Gift Card ($25)|25.00
Book of Stamps (20)|15.60
Propane Tank Exchange|24.99
Lottery Ticket (you won't win)|2.00
Reusable Bag|0.99` },
];

CATALOG.forEach(s => {
  s.items = s.items.trim().split('\n').map((line, i) => {
    const [name, price] = line.split('|');
    return { key: `${s.id}:${i}`, name: name.trim(), price: +price, sec: s.id };
  });
});

if (typeof module !== 'undefined') module.exports = { CATALOG };
