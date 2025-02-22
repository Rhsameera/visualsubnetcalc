# Visual Subnet Calculator)

![demo.gif](src%2Fdemo.gif)

Visual Subnet Calculator is a modernized tool based on the original work by [davidc](https://github.com/davidc/subnets) and [ckabalan](https://github.com/ckabalan).
It strives to be a tool for quickly designing networks and collaborating on that design with others. It focuses on
expediting the work of network administrators, not academic subnetting math.

## Design Tenets

The following tenets are the most important values that drive the design of the tool. New features, pull requests, etc
should align to these tenets, or propose an adjustment to the tenets.

- **Simplicity is king.** Network admins are busy and Visual Subnet Calculator should always be easy for FIRST TIME USERS to
  quickly and intuitively use.
- **Subnetting is design work.** Promote features that enhance visual clarity and easy mental processing of even the most
  complex architectures.
- **Users control the data.** We store nothing, but provide convenient ways for users to save and share their designs.
- **Embrace community contributions.** Consider and respond to all feedback and pull requests in the context of these
  tenets.

## Building From Source

If you have a more opinionated best-practice way to lay out this repository please open an issue.

Build prerequisites:
- (Optional but recommended) NVM to manage node version
- node.js (version 20) and associated NPM.
- sass (Globally installed, following instructions below.)

Compile from source:

```shell
# Clone the repository
> git clone https://github.com/rhsameera/visualsubnetcalc
# Use recommended NVM version
> nvm use
# Change to the sources directory
> cd visualsubnetcalc/src
# Install Bootstrap
> npm install
# Compile Bootstrap (Also install sass command line globally)
> npm run build
# Run the local webserver
> npm start
```

The full application should then be available within `./dist/`, open `./dist/index.html` in a browser.

## Credits

Split icon made by [Freepik](https://www.flaticon.com/authors/freepik) from [Flaticon](https://www.flaticon.com/).

## License

Visual Subnet Calculator is released under the [MIT License](https://opensource.org/licenses/MIT)
