const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const utils = require("./utils");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const MongoStore = require("connect-mongo");
const User = require("./models/user");
const Cart = require("./models/cart");
const Order = require("./models/order");
require("dotenv").config();

const app = express();
const DB_URL = process.env.DB_URL;
const SECRET_KEY = process.env.SECRET_KEY;
const metadata = utils.readJson("metadata.json");
const items = utils.readJson("items.json");
const categories = utils.readJson("categories.json");
// App Config

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Connect mongoose to the sessions to persist the data across server restarts
app.use(
  session({
    secret: SECRET_KEY,
    resave: false,
    saveUninitialized: false, // Only save sessions that are actually modified
    store: MongoStore.create({
      mongoUrl: DB_URL,
      ttl: 14 * 24 * 60 * 60, // Session expiration in seconds (14 days by default)
    }),
    cookie: {
      secure: false, // Set true if using HTTPS
      maxAge: 14 * 24 * 60 * 60 * 1000, // Cookie expiration in milliseconds (14 days)
    },
  }),
);

function isAuthenticated(req, res, next) {
  if (req.session.user) {
    next(); // User is logged in, proceed to the next middleware or route
  } else {
    res.redirect("/login"); // Redirect to login if not authenticated
  }
}

app.get(["/", "/home"], (req, res) => {
  res.render("home", {
    ...utils.readJson("home.json"),
    ...metadata,
    categories: categories,
  });
});

app.get("/category/:category", (req, res) => {
  const category = req.params.category;
  const filteredItems = items.filter((item) => item.category === category);
  res.render("category", {
    items: filteredItems,
    category: category,
    categories: categories,
    ...metadata,
  });
});

app.get("/product/:id", (req, res) => {
  const itemId = parseInt(req.params.id);
  const product = items.find((item) => item.id === itemId);

  if (product) {
    res.render("inner_page", {
      product,
      categories: categories,
      ...metadata,
    });
  } else {
    res.status(404).send("Product not found");
  }
});

app.get("/cart", isAuthenticated, async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.session.user.id }).populate(
      "user",
    );
    res.render("cart", {
      cart: cart ? cart.items : [],
      cartCount: cart ? cart.items.length : 0,
      categories,
      ...metadata,
    });
  } catch (error) {
    console.error("Error fetching cart:", error);
    res.status(500).send("An error occurred while fetching the cart.");
  }
});

app.post("/add-to-cart/:id", isAuthenticated, async (req, res) => {
  const itemId = parseInt(req.params.id);
  const item = items.find((item) => item.id === itemId); // Fetch item from JSON file

  if (!item) {
    return res.status(404).send("Item not found");
  }

  try {
    let cart = await Cart.findOne({ user: req.session.user.id });
    if (!cart) {
      cart = new Cart({ user: req.session.user.id, items: [] });
    }
    const existingItem = cart.items.find(
      (cartItem) => cartItem.productId === itemId,
    );

    if (existingItem) {
      existingItem.quantity += 1;
    } else {
      cart.items.push({
        productId: item.id,
        name: item.name,
        price: item.price,
        image: item.image,
        quantity: 1,
      });
    }
    await cart.save();
    res.redirect("/cart");
  } catch (error) {
    console.error("Error adding to cart:", error);
    res
      .status(500)
      .send("An error occurred while adding the item to the cart.");
  }
});

app.post("/update-cart/:id", isAuthenticated, async (req, res) => {
  const itemId = parseInt(req.params.id);
  const action = req.body.action;

  try {
    const cart = await Cart.findOne({ user: req.session.user.id });
    if (!cart) {
      return res.status(404).send("Cart not found");
    }
    const item = cart.items.find((cartItem) => cartItem.productId === itemId);
    if (!item) {
      return res.status(404).send("Item not found in cart");
    }
    if (action === "increment") {
      item.quantity += 1;
    } else if (action === "decrement" && item.quantity > 1) {
      item.quantity -= 1;
    }
    await cart.save();
    res.redirect("/cart");
  } catch (error) {
    console.error("Error updating cart:", error);
    res.status(500).send("An error occurred while updating the cart.");
  }
});

app.get("/register", (req, res) => {
  res.render("register");
});

app.post("/register", async (req, res) => {
  const { username, email, phone, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      username,
      email,
      phone,
      password: hashedPassword,
    });
    await newUser.save();
    res.redirect("/login");
  } catch (error) {
    console.error("Error registering user:", error);
    res.status(500).send("An error occurred during registration.");
  }
});

app.get("/login", (req, res) => {
  if (req.session.user) {
    return res.redirect("/profile");
  }
  res.render("login");
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).send("Invalid email or password.");
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).send("Invalid email or password.");
    }
    req.session.user = {
      id: user._id,
      username: user.username,
      email: user.email,
    };
    res.redirect("/");
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).send("An error occurred during login.");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error during logout:", err);
      return res.status(500).send("An error occurred during logout.");
    }
    res.redirect("/");
  });
});

app.post("/checkout", async (req, res) => {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  try {
    const cart = await Cart.findOne({ user: req.session.user.id });
    if (!cart || cart.items.length === 0) {
      return res.status(400).send("Your cart is empty.");
    }
    const subTotal = cart.items.reduce(
      (total, item) => total + item.price * item.quantity,
      0,
    );
    const order = new Order({
      user: req.session.user.id,
      items: cart.items,
      subTotal,
    });
    await order.save();
    cart.items = [];
    await cart.save();
    res.redirect("/orders");
  } catch (error) {
    console.error("Error during checkout:", error);
    res.status(500).send("An error occurred during checkout.");
  }
});

app.get("/orders", async (req, res) => {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  try {
    const orders = await Order.find({ user: req.session.user.id });
    res.render("orders", { orders, ...metadata });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).send("An error occurred while fetching your orders.");
  }
});

app.get("/orders/:id", async (req, res) => {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  const orderId = req.params.id;
  try {
    const order = await Order.findOne({
      _id: orderId,
      user: req.session.user.id,
    });
    if (!order) {
      return res.status(404).send("Order not found or access denied.");
    }
    res.render("order_details", { order, ...metadata });
  } catch (error) {
    console.error("Error fetching order details:", error);
    res.status(500).send("An error occurred while fetching the order details.");
  }
});

app.post("/reorder/:id", async (req, res) => {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  const orderId = req.params.id;
  try {
    const order = await Order.findOne({
      _id: orderId,
      user: req.session.user.id,
    });
    if (!order) {
      return res.status(404).send("Order not found or access denied.");
    }
    let cart = await Cart.findOne({ user: req.session.user.id });
    if (!cart) {
      cart = new Cart({ user: req.session.user.id, items: [] });
    }
    order.items.forEach((orderItem) => {
      const existingItem = cart.items.find(
        (item) => item.productId === orderItem.productId,
      );
      if (existingItem) {
        existingItem.quantity += orderItem.quantity;
      } else {
        cart.items.push({
          productId: orderItem.productId,
          name: orderItem.name,
          price: orderItem.price,
          category: orderItem.category,
          quantity: orderItem.quantity,
        });
      }
    });
    await cart.save();
    res.redirect("/cart");
  } catch (error) {
    console.error("Error during reorder:", error);
    res.status(500).send("An error occurred while processing your reorder.");
  }
});

app.get("/profile", async (req, res) => {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  try {
    const user = await User.findById(req.session.user.id).select("-password");
    if (!user) {
      return res.status(404).send("User not found.");
    }
    res.render("profile", { user, ...metadata });
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).send("An error occurred while fetching your profile.");
  }
});

const PORT = 8080;
mongoose
  .connect(DB_URL)
  .then(() => console.log("MongoDB connected successfully"))
  .catch((err) => console.error("MongoDB connection error:", err));
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
