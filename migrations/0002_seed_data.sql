INSERT INTO publishers (name, website, geography, primary_category, status) VALUES
  ('BuzzFeed Inc.',        'buzzfeed.com',        'United States', 'Entertainment', 'active'),
  ('Vox Media',            'voxmedia.com',         'United States', 'News',          'active'),
  ('Trusted Media Brands', 'tmbi.com',             'United States', 'Comedy',        'active'),
  ('DailyMail',            'dailymail.co.uk',      'United Kingdom','News',          'active'),
  ('Bustle Digital Group', 'bustle.com',           'United States', 'Lifestyle',     'active'),
  ('McClatchy',            'mcclatchy.com',        'United States', 'News',          'active'),
  ('ADWEEK',               'adweek.com',           'United States', 'Business',      'active'),
  ('Refinery29',           'refinery29.com',       'United States', 'Fashion',       'active'),
  ('Group Nine Media',     'groupninemedia.com',   'United States', 'Entertainment', 'active'),
  ('Condé Nast',           'condenast.com',        'United States', 'Fashion',       'active');

INSERT INTO handles (handle_name, platform, brand_name, publisher_id, profile_url, categories, followers, geography, property_url, featured, status) VALUES
  ('@tasty',             'fb', 'Tasty',       1, 'https://facebook.com/tasty',              '["Food","Recipes","Cooking","CPG"]',        101900000, 'United States', 'tasty.co',          1, 'active'),
  ('@buzzfeedtasty',     'ig', 'Tasty',       1, 'https://instagram.com/buzzfeedtasty',     '["Food","Recipes","Cooking"]',               44200000, 'United States', 'tasty.co',          1, 'active'),
  ('@thedodo',           'fb', 'The Dodo',    2, 'https://facebook.com/thedodo',            '["Pets","Animals","CPG"]',                   52000000, 'United States', 'thedodo.com',       1, 'active'),
  ('@buzzfeedtastyhome', 'fb', 'Tasty Home',  1, 'https://facebook.com/buzzfeedtastyhome',  '["Food","Home","Cooking"]',                  30300000, 'United States', 'tasty.co',          0, 'active'),
  ('@failarmy',          'fb', 'FailArmy',    3, 'https://facebook.com/failarmy',           '["Comedy","Fails","Viral","UGC"]',           26400000, 'United States', 'failarmy.com',      1, 'active'),
  ('@dailymail',         'fb', 'Daily Mail',  4, 'https://facebook.com/dailymail',          '["News","Entertainment","Lifestyle"]',       18300000, 'United Kingdom','dailymail.co.uk',   1, 'active'),
  ('@90skidsbustle',     'fb', '90s Kids',    5, 'https://facebook.com/90skidsbustle',      '["Nostalgia","Lifestyle","Entertainment"]',   1100000, 'United States', 'bustle.com',        0, 'paused'),
  ('@adweek',            'ig', 'Adweek',      7, 'https://instagram.com/adweek',            '["Marketing","Advertising","Business"]',      585000, 'United States', 'adweek.com',        0, 'active');
