const seasonTicket = require("../../models/seasonTicket");
const booking = require("../../models/booking");
const axios = require("axios");
const xml2js = require("xml2js");
const parsers = new xml2js.Parser({ explicitArray: false });
const user = require("../../models/user");
const cancelTicket = require("../../models/cancelTicket");
const mongoose = require("mongoose");
const messages = require("../../helpers/appConstants");
const moment = require("moment");
const { paymentStripe } = require("../../helpers/stripe");
const { Email } = require("../../helpers/email");
const fs = require("fs");
const {
  paginationData,
  randomAlphaNumericCode,
  createErrorResponse,
  createSuccessResponse,
} = require("../../helpers/utils");
const { duration } = require("moment");
const seasonTicketKeys = [
  "passengerType",
  "financeBy",
  "duration",
  "paymentType",
  // "leave",
  "startDate",
  "endDate",
];

const listSeasonticket = async function (req, res) {
  let { offset, order, sort, search, limit, filter } = req.body;
  let query = [];
  let pagination = [];
  let searchObj = { $regex: new RegExp(".*" + search + ".*", "i") };
  if (offset && limit) {
    pagination = [{ $skip: offset }, { $limit: limit }];
  } else pagination = [{ $skip: 0 }, { $limit: 10 }];
  query.push(
    {
      $lookup: {
        from: "users",
        let: { id: "$user" },
        pipeline: [
          {
            $match: {
              $expr: {
                $eq: ["$_id", "$$id"],
              },
            },
          },
          {
            $project: {
              fullName: 1,
              email: 1,
              city: 1,
              userId: 1,
              billing: 1,
            },
          },
        ],
        as: "user",
      },
    },
    { $unwind: { path: "$user" } }
  );
  if (search) {
    query.push({
      $match: {
        $or: [
          {
            "user.fullName": searchObj,
          },
          {
            "user.email": searchObj,
          },
          // {
          //     'user.lastName': searchObj
          // },
          {
            ticketId: searchObj,
          },
          {
            "user.city": searchObj,
          },
        ],
      },
    });
  }

  let project = {
    $project: {
      createdAt: 1,
      updatedAt: -1,
      user: 1,
      ticketId: 1,
      price: 1,
      source: 1,
      destination: 1,
      passengerType: 1,
      duration: 1,
      financeBy: 1,
      paymentType: 1,
      isApproved: 1,
      isRejected: 1,
      isPending: 1,
      validUpto: 1,
      status: {
        $cond: {
          if: {
            $eq: ["$isApproved", true],
          },
          then: "Approved",
          else: {
            $cond: [{ $eq: ["$isRejected", true] }, "Rejected", "Pending"],
          },
        },
      },
    },
  };
  query.push(project);

  if (filter == "approved") {
    query.push({
      $match: {
        isApproved: true,
      },
    });
  } else if (filter == "rejected") {
    query.push({
      $match: {
        isRejected: true,
      },
    });
  } else if (filter == "pending") {
    query.push({
      $match: {
        isPending: true,
      },
    });
  } else if (filter == "all") {
    query.push({ $match: {} });
  }

  let sortQry = {};
  let userId = "user.";
  let sort_element;
  if (sort == "ticketId" || sort == "paymentType") sort_element = sort;
  else sort_element = userId.concat(sort);

  if (sort && order) {
    sortQry[sort_element] = order;
    query.push({
      $sort: sortQry,
    });
  } else {
    sortQry["createdAt"] = -1;
    query.push({
      $sort: sortQry,
    });
  }

  query.push(
    {
      $facet: {
        data: pagination,
        totalCount: [
          {
            $count: "count",
          },
        ],
      },
    },
    {
      $unwind: {
        path: "$totalCount",
        preserveNullAndEmptyArrays: true,
      },
    }
  );
  const seasonticketList = await seasonTicket.aggregate(query);
  let TotalCount =
    seasonticketList && seasonticketList[0] && seasonticketList[0].totalCount
      ? seasonticketList[0].totalCount.count
      : 0;
  res.status(200).json({
    success: true,
    data: {
      seasonticketList:
        seasonticketList && seasonticketList[0] && seasonticketList[0].data
          ? seasonticketList[0].data
          : [],
      paginateData: paginationData(TotalCount, limit, offset),
    },
    message: messages.dataFetch,
  });
};
const editSeasonticket = async function (req, res) {
  user
    .findOneAndUpdate(
      { _id: req.body.userId },
      {
        fullName: req.body.fullName,
        phoneNumber: req.body.phoneNumber,
        address: req.body.address,
        city: req.body.city,
        postalCode: req.body.postalCode,
      }
    )
    .then(
      res
        .status(200)
        .json({ success: true, message: messages.seasonTicketupdate })
    );
};
const viewSeasonticket = async function (req, res) {
  const checkId = mongoose.isValidObjectId(req.body.id);
  if (!checkId)
    return res
      .status(400)
      .json({ success: false, message: messages.invalidId });
  const data = await seasonTicket
    .findOne({ _id: req.body.id })
    .populate(
      "user",
      "email fullName  userId postalCode city address phoneNumber createdAt billing card.cardNumber",
      user
    )
    .select("");
  if (data)
    return res
      .status(200)
      .json({ success: true, data, message: messages.dataFetch });
  else
    return res.status(400).json({ success: false, message: messages.noData });
};
const accrejSeasonticket = async function (req, res) {
  const checkId = mongoose.isValidObjectId(req.body.id);
  if (!checkId)
    return res
      .status(400)
      .json({ success: false, message: messages.invalidId });
  const check = await seasonTicket.findOne({ _id: req.body.id });
  if (!check)
    return res.status(400).json({ success: false, message: messages.userNot });
  if (req.body.status == "approve") {
    const checkReq = await seasonTicket.findOne({
      _id: req.body.id,
      isApproved: "true",
    });
    if (checkReq)
      return res
        .status(400)
        .json({ success: false, message: messages.acceptAl });
    await seasonTicket.findOneAndUpdate(
      { _id: req.body.id },
      {
        isApproved: "true",
        isPending: "false",
        isRejected: "false",
      }
    );
    return res
      .status(200)
      .json({ success: true, message: messages.requestAccept });
  } else if (req.body.status == "reject") {
    const checkReq = await seasonTicket.findOne({
      _id: req.body.id,
      isRejected: "true",
    });
    if (checkReq)
      return res
        .status(400)
        .json({ success: false, message: messages.rejectAl });
    await seasonTicket.findOneAndUpdate(
      { _id: req.body.id },
      {
        isRejected: "true",
        isPending: "false",
        isApproved: "false",
      }
    );
    return res
      .status(200)
      .json({ success: true, message: messages.requestReject });
  } else {
    return res
      .status(400)
      .json({ success: false, message: messages.statusNot });
  }
};

const seasonDetail = async (req, res, next) => {
  const checkTicket = await seasonTicket
    .findOne({ user: req.token._id })
    .populate("user", "card");
  if (checkTicket)
    return res
      .status(200)
      .json(createSuccessResponse(messages.addSeasonTicket, checkTicket));
  else
    return res
      .status(200)
      .json(createSuccessResponse(messages.addSeasonTicket, null));
};

const addSeasonTicket = async (req, res, next) => {
  const userDetails = req.token;
  const checkTicket = await seasonTicket.findOne({ user: req.token._id });
  if (checkTicket)
    return res
      .status(200)
      .json(createSuccessResponse("You already have a season ticket."));

  const startDate = moment(req.body.startDate).format("YYYY-MM-DDTHH:mm:ss");
  const returnDate = moment(req.body.startDate)
    .add(1, "M")
    .format("YYYY-MM-DDTHH:mm:ss");
  if (!req.body?.endDate) {
    req.body.endDate = moment(req.body.startDate)
      .add(req.body?.duration, "M")
      .format("YYYY-MM-DDTHH:mm:ss.m");
  }

  let passengerType;
  if (req.body.passengerType.toLowerCase() == "adult") {
    passengerType = `<PassengerType Code="Adult" Quantity="1" />`;
  } else {
    passengerType = `<PassengerType Code="Children" Quantity="1" />`;
  }

  const xmlFirst = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
    <soap:Header>
        <wsa:Action>http://www.opentravel.org/OTA/2003/05/otaRailAvail</wsa:Action>
        <wsa:MessageID>urn:uuid:dc72983d-8871-431a-97d5-8f386f984592</wsa:MessageID>
        <wsa:ReplyTo>
            <wsa:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address>
        </wsa:ReplyTo>
        <wsa:To> https://thepassengerhub.evolviuat.com/evolvi.webapi/soapapi</wsa:To>
        <wsse:Security>
            <wsse:UsernameToken wsu:Id="SecurityToken-a60b73fb-8dba-457b-9ca0-954e32ebe1f4">
                <wsse:Username>Passenger</wsse:Username>
                <wsse:Password>PH47yrj$</wsse:Password>
            </wsse:UsernameToken>
        </wsse:Security>
    </soap:Header>
    <soap:Body>
        <OTA_RailAvailRQ xmlns="http://www.opentravel.org/OTA/2003/05" TimeStamp="2022-02-21T07:00:00.7939026Z" Target="Test" Version="2.8" TransactionIdentifier="8317120d-8e2e-4dfd-bb4d-5cc8756d3b30" SequenceNmbr="1" ResponseType="Fares">
            <POS xmlns="http://www.opentravel.org/OTA/2003/05">
                <Source AgentSine="" PseudoCityCode="">
                    <RequestorID Type="" ID="richard@thepassengerhub.com" MessagePassword="Tph321???" />
                    <BookingChannel>
                        <CompanyName xsi:type="CompanyNamePrefType" CompanyShortName="thepassengerhub" />
                    </BookingChannel>
                </Source>
            </POS>
            <RailAvailInfo TrainNumber="Season" Class="First" xmlns="http://www.opentravel.org/OTA/2003/05">
                <OriginDestinationInformation>
                    <DepartureDateTime>${startDate}</DepartureDateTime>
                    <OriginLocation LocationCode="${req.body.source.StationCRSCode}" CodeContext="CRS"/>
                    <DestinationLocation LocationCode="${req.body.destination.StationCRSCode}" CodeContext="CRS"/>
                </OriginDestinationInformation>
                ${passengerType}
                <ReturnDateTime>
                    <DepartureDateTime>${returnDate}</DepartureDateTime>
                </ReturnDateTime>
            </RailAvailInfo>
            <TPA_Extensions xmlns="http://www.opentravel.org/OTA/2003/05">
                <AutoApplyDiscounts>true</AutoApplyDiscounts>
                <TreatReturnFaresAsHalfPrice>false</TreatReturnFaresAsHalfPrice>
                <ShowAdditionalJourneyFareAttributes>false</ShowAdditionalJourneyFareAttributes>
                <PreferNlcToCrs>false</PreferNlcToCrs>
                <OmitItxWithoutMatchingRouteCode>false</OmitItxWithoutMatchingRouteCode>
                <ExtraTimeToChange>true</ExtraTimeToChange>
                <Prioritise>Unknown</Prioritise>
            </TPA_Extensions>
        </OTA_RailAvailRQ>
    </soap:Body>
</soap:Envelope>`;

  const xmlStandard = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
    <soap:Header>
        <wsa:Action>http://www.opentravel.org/OTA/2003/05/otaRailAvail</wsa:Action>
        <wsa:MessageID>urn:uuid:dc72983d-8871-431a-97d5-8f386f984592</wsa:MessageID>
        <wsa:ReplyTo>
            <wsa:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address>
        </wsa:ReplyTo>
        <wsa:To> https://thepassengerhub.evolviuat.com/evolvi.webapi/soapapi</wsa:To>
        <wsse:Security>
            <wsse:UsernameToken wsu:Id="SecurityToken-a60b73fb-8dba-457b-9ca0-954e32ebe1f4">
                <wsse:Username>Passenger</wsse:Username>
                <wsse:Password>PH47yrj$</wsse:Password>
            </wsse:UsernameToken>
        </wsse:Security>
    </soap:Header>
    <soap:Body>
        <OTA_RailAvailRQ xmlns="http://www.opentravel.org/OTA/2003/05" TimeStamp="2022-02-21T07:00:00.7939026Z" Target="Test" Version="2.8" TransactionIdentifier="8317120d-8e2e-4dfd-bb4d-5cc8756d3b30" SequenceNmbr="1" ResponseType="Fares">
            <POS xmlns="http://www.opentravel.org/OTA/2003/05">
                <Source AgentSine="" PseudoCityCode="">
                    <RequestorID Type="" ID="richard@thepassengerhub.com" MessagePassword="Tph321???" />
                    <BookingChannel>
                        <CompanyName xsi:type="CompanyNamePrefType" CompanyShortName="thepassengerhub" />
                    </BookingChannel>
                </Source>
            </POS>
            <RailAvailInfo TrainNumber="Season" Class="Standard" xmlns="http://www.opentravel.org/OTA/2003/05">
                <OriginDestinationInformation>
                    <DepartureDateTime>${startDate}</DepartureDateTime>
                    <OriginLocation LocationCode="${req.body.source.StationCRSCode}" CodeContext="CRS"/>
                    <DestinationLocation LocationCode="${req.body.destination.StationCRSCode}" CodeContext="CRS"/>
                </OriginDestinationInformation>
                ${passengerType}
                <ReturnDateTime>
                    <DepartureDateTime>${returnDate}</DepartureDateTime>
                </ReturnDateTime>
            </RailAvailInfo>
            <TPA_Extensions xmlns="http://www.opentravel.org/OTA/2003/05">
                <AutoApplyDiscounts>true</AutoApplyDiscounts>
                <TreatReturnFaresAsHalfPrice>false</TreatReturnFaresAsHalfPrice>
                <ShowAdditionalJourneyFareAttributes>false</ShowAdditionalJourneyFareAttributes>
                <PreferNlcToCrs>false</PreferNlcToCrs>
                <OmitItxWithoutMatchingRouteCode>false</OmitItxWithoutMatchingRouteCode>
                <ExtraTimeToChange>true</ExtraTimeToChange>
                <Prioritise>Unknown</Prioritise>
            </TPA_Extensions>
        </OTA_RailAvailRQ>
    </soap:Body>
</soap:Envelope>`;

  let config = {
    headers: { "Content-Type": "application/xml" },
  };

  try {
    const price = await Promise.all([
      firstClass(
        xmlFirst,
        config,
        req.body?.ticketType,
        req.body?.durations,
        req.body.startDate,
        req.body.endDate
      ),
      standardClass(
        xmlStandard,
        config,
        req.body?.ticketType,
        req.body?.durations,
        req.body.startDate,
        req.body.endDate
      ),
    ]);

    const obj = Object.assign({});
    obj.price = {};
    obj.price.first = price[0].first;
    obj.price.standard = price[1].standard;

    seasonTicketKeys.map((keys) => {
      obj[keys] = req.body[keys];
    });
    const start = moment(req.body.startDate);
    const end = moment(req.body.endDate);
    const months = end.diff(start, "months");
    start.add(months, "months");
    const days = end.diff(start, "days");

    obj.duration =
      req.body?.ticketType === "seasonTicket"
        ? { m: parseInt(req.body?.duration), d: 0 }
        : { m: months, d: days };
    obj.endDate = moment(req.body.endDate);
    obj.source = req.body.source.StationName;
    obj.sourceCRSCode = req.body.source.StationCRSCode;
    obj.destination = req.body.destination.StationName;
    obj.destinationCRSCode = req.body.destination.StationCRSCode;
    obj.card = userDetails.card;
    obj.user = {
      name: userDetails.fullName,
      address: userDetails.address,
      phone: userDetails.phoneNumber,
    };

    return res
      .status(200)
      .json(createSuccessResponse(messages.addSeasonTicket, obj));
  } catch (err) {
    return res
      .status(400)
      .json(createErrorResponse(err || "Something went wrong."));
  }
};

const firstClass = (
  xmlFirst,
  config,
  ticketType,
  durations,
  startDate,
  endDate
) => {
  return new Promise(async (resolve, reject) => {
    try {
      const data = await axios.post(
        "https://thepassengerhub.evolviuat.com/evolvi.webapi/soapapi",
        xmlFirst,
        config
      );
      let price;
      data
        ? parsers.parseString(data.data, async function (err, result) {
            if (err) console.log(err);

            if (result.Envelope.Body.OTA_RailAvailRS.Errors) {
              const error =
                result.Envelope.Body.OTA_RailAvailRS.Errors.Error._.replace(
                  /&#xD;&#xD;/g,
                  ""
                );
              return reject("No fares found");
            }

            if (
              result.Envelope.Body.OTA_RailAvailRS.Fares.Fare[0] == undefined
            ) {
              price = await getPrices(
                result.Envelope.Body.OTA_RailAvailRS.Fares.Fare
                  .SeasonTicketPrices.SeasonTicketPrice,
                durations,
                ticketType,
                startDate,
                endDate
              );
            } else if (
              result.Envelope.Body.OTA_RailAvailRS.Fares.Fare.length > 0
            ) {
              price = await getPrices(
                result.Envelope.Body.OTA_RailAvailRS.Fares.Fare[0]
                  .SeasonTicketPrices.SeasonTicketPrice,
                durations,
                ticketType,
                startDate,
                endDate
              );
            }
            resolve({ first: price });
          })
        : reject();
    } catch (err) {
      reject();
    }
  });
};

const standardClass = (
  xmlStandard,
  config,
  ticketType,
  durations,
  startDate,
  endDate
) => {
  return new Promise(async (resolve, reject) => {
    try {
      const data = await axios.post(
        "https://thepassengerhub.evolviuat.com/evolvi.webapi/soapapi",
        xmlStandard,
        config
      );

      let price;
      data
        ? parsers.parseString(data.data, async function (err, result) {
            if (err) console.log(err);

            if (result.Envelope.Body.OTA_RailAvailRS.Errors) {
              const error =
                result.Envelope.Body.OTA_RailAvailRS.Errors.Error._.replace(
                  /&#xD;&#xD;/g,
                  ""
                );
              return reject("No fares found");
            }

            if (
              result.Envelope.Body.OTA_RailAvailRS.Fares.Fare[0] == undefined
            ) {
              price = await getPrices(
                result.Envelope.Body.OTA_RailAvailRS.Fares.Fare
                  .SeasonTicketPrices.SeasonTicketPrice,
                durations,
                ticketType,
                startDate,
                endDate
              );
            } else if (
              result.Envelope.Body.OTA_RailAvailRS.Fares.Fare.length > 0
            ) {
              price = await getPrices(
                result.Envelope.Body.OTA_RailAvailRS.Fares.Fare[0]
                  .SeasonTicketPrices.SeasonTicketPrice,
                durations,
                ticketType,
                startDate,
                endDate
              );
            }

            resolve({ standard: price });
          })
        : reject();
    } catch (err) {
      reject();
    }
  });
};

const getPrices = (priceArr, durations, ticketType, startDate, endDate) => {
  return new Promise((resolve) => {
    const price = [];
    priceArr.map((e) => {
      if (e.$.MonthsValid == 1 && e.$.DaysValid == 0) {
        const dayPrice = (e.Price.$.Amount / 30).toFixed(2);

        const start = moment(startDate);
        const end = moment(endDate);
        const months = end.diff(start, "months");
        start.add(months, "months");
        const days = end.diff(start, "days");

        ticketType === "flexiTicket" &&
          price.push({
            d: { m: months, d: days },
            p: (dayPrice * (months * 30 + days)).toFixed(2),
            v: moment(endDate),
          });
        durations.forEach((m) => {
          price.push({
            d: { m, d: 0 },
            p: (dayPrice * (m * 30)).toFixed(2),
            v: moment(startDate).add(parseInt(m), "M"),
          });
        });
      }
    });
    resolve(price);
  });
};

const cancelTicketList = async (req, res) => {
  try {
    const data = await cancelTicket.find();
    res.status(200).json({ success: true, data });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: err || "Something went wrong." });
  }
};

const cancelSeasonTicket = async (req, res, next) => {
  const userDetails = req.token;
  const checkTicket = await booking.findOne({
    user: req.token._id,
    ticketId: req.body.ticketId,
  });

  if (!checkTicket)
    return res.status(200).json(createSuccessResponse("Ticket not exists."));

  const obj = Object.assign({});
  obj.user = req.token._id;
  obj.ticketId = checkTicket.ticketId;
  obj.reason = req.body?.reason;
  obj.price = checkTicket.price;
  obj.paymentType = checkTicket.paymentType;
  obj.isApproved = checkTicket.isApproved;
  obj.isRejected = checkTicket.isRejected;
  obj.isPending = checkTicket.isPending;

  await new cancelTicket(obj).save();

  return res.status(200).json({ success: true });

  const xml = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
    <soap:Header>
        <wsa:Action>http://www.opentravel.org/OTA/2003/05/otaRailAvail</wsa:Action>
        <wsa:MessageID>urn:uuid:dc72983d-8871-431a-97d5-8f386f984592</wsa:MessageID>
        <wsa:ReplyTo>
            <wsa:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address>
        </wsa:ReplyTo>
        <wsa:To> https://thepassengerhub.evolviuat.com/evolvi.webapi/soapapi</wsa:To>
        <wsse:Security>
            <wsse:UsernameToken wsu:Id="SecurityToken-a60b73fb-8dba-457b-9ca0-954e32ebe1f4">
                <wsse:Username>Passenger</wsse:Username>
                <wsse:Password>PH47yrj$</wsse:Password>
            </wsse:UsernameToken>
        </wsse:Security>
    </soap:Header>
    <soap:Body>
        <OTA_CancelRQ xmlns="http://www.opentravel.org/OTA/2003/05" Version="2.8" SequenceNmbr="1" CancelType="Book">
            <POS xmlns="http://www.opentravel.org/OTA/2003/05">
                <Source AgentSine="" PseudoCityCode="">
                    <RequestorID Type="" ID="richard@thepassengerhub.com" MessagePassword="Tph321???" />
                    <BookingChannel>
                        <CompanyName xsi:type="CompanyNamePrefType" CompanyShortName="thepassengerhub" />
                    </BookingChannel>
                </Source>
            </POS>
            <UniqueID Type="OrderID" ID="${req.body.ticketId}" xmlns="http://www.opentravel.org/OTA/2003/05">
            </UniqueID>
            <CancelRequests>
              <CancelRequest></CancelRequest>
              <UniqueID Type="OrderItemID" ID="${req.body.ticketId}"></UniqueID>
            </CancelRequests>
        </OTA_CancelRQ>
    </soap:Body>
</soap:Envelope>`;

  let config = {
    headers: { "Content-Type": "application/xml" },
  };

  let data = "";

  try {
    data = await axios.post(
      "https://thepassengerhub.evolviuat.com/evolvi.webapi/soapapi",
      xml,
      config
    );
    console.log("data: ", data);
  } catch (err) {
    return res.status(400).json({ success: false, err });
  }

  res.status(200).json({ success: true, data });
};

const seasonPayment = async (req, res, next) => {
  const userDetails = req.token;
  const obj = Object.assign({});
  obj.user = req.token._id;
  req.body.email = userDetails.email;
  obj.address = userDetails.address;
  obj.ticketId = randomAlphaNumericCode();
  obj.price = parseFloat(req.body.data.price);
  seasonTicketKeys.map((keys) => {
    obj[keys] = req.body.data[keys];
  });
  obj.validUpto = req.body.data.validUpto;
  obj.paymentType = req.body.paymentType;
  obj.source = req.body.data.source;
  obj.sourceCRSCode = req.body.data.sourceCRSCode;
  obj.destination = req.body.data.destination;
  obj.destinationCRSCode = req.body.data.destinationCRSCode;
  obj.card = req.body.data.card;
  if (req.body.paymentType.toLowerCase() == "pay") {
    paymentStripe(
      userDetails.card.stripeCustomerId,
      parseInt(req.body.data.price)
    )
      .then(async (success) => {
        // console.log("success", success);
        await new seasonTicket(obj).save();
        sendPaymentMail(req, res, obj);
        return res
          .status(200)
          .json(createSuccessResponse(messages.paymentSuccessfully));
      })
      .catch((err) => {
        console.log("err", err);
        return res.status(400).json(createErrorResponse(err.raw.message));
      });
  } else {
    const saveDetail = await new seasonTicket(obj).save();
    if (saveDetail) {
      sendPaymentMail(req, res, obj);
      return res
        .status(200)
        .json(createSuccessResponse(messages.paymentSuccessfully));
    } else return res.status(400).json(createErrorResponse("Payment failed."));
  }
};

const sendPaymentMail = (req, res, data) => {
  let subject = "Order Placed Successfully";
  let text = "Order Placed Successfully";
  fs.readFile("html/orderPlaced.html", "utf-8", function (err, d) {
    let responseData = d.replace("ADDRESS", `${data.address}`);
    responseData = responseData.replace("TICKETID", `${data.ticketId}`);
    responseData = responseData.replace("ORDERDATE", moment().format("LLL"));
    responseData = responseData.replace("PRICE", `${data.price}`);
    Email(req, res, subject, text, responseData);
    return;
  });
};

module.exports = {
  listSeasonticket,
  editSeasonticket,
  viewSeasonticket,
  accrejSeasonticket,
  addSeasonTicket,
  seasonDetail,
  cancelSeasonTicket,
  seasonPayment,
  cancelTicketList,
};
